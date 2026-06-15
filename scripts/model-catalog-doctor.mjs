import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DOCTOR_SCHEMA_VERSION } from './doctor-schema.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_CATALOG_PATH = path.join(repoRoot, 'config/model-catalog.json');
const COMPILED_CATALOG_MODULE = path.join(repoRoot, 'packages/core/dist/model-catalog.js');

const KIND = 'model-catalog-doctor';

/**
 * Load the catalog normalizer from the compiled core output. The doctor
 * deliberately reuses the SAME normalizer the selector routes on, so what the
 * doctor reports and what the selector will accept can never drift. Requires a
 * prior `npm run build` (the `doctor:model-catalog` script builds core first),
 * mirroring how planner-smoke.mjs imports apps/broker/dist.
 */
async function loadCatalogModule() {
  try {
    return await import(COMPILED_CATALOG_MODULE);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const hint =
      'Compiled core not found. Build it first: `npm --workspace @switchboard/core run build`.';
    throw new CatalogDoctorError('model_catalog_core_unbuilt', `${hint} (${detail})`);
  }
}

/** A doctor-level failure that maps to a specific blocking failure code. */
class CatalogDoctorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CatalogDoctorError';
    this.code = code;
  }
}

async function readCatalogFile(catalogPath) {
  let contents;
  try {
    contents = await readFile(catalogPath, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CatalogDoctorError(
      'model_catalog_unreadable',
      `Could not read model catalog at ${path.relative(repoRoot, catalogPath)}: ${detail}`,
    );
  }

  try {
    return JSON.parse(contents);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CatalogDoctorError(
      'model_catalog_invalid',
      `Model catalog at ${path.relative(repoRoot, catalogPath)} is not valid JSON: ${detail}`,
    );
  }
}

function describeIssue(issue) {
  return {
    index: issue.index,
    kind: issue.kind,
    message: issue.message,
    ...(issue.provider !== undefined ? { provider: issue.provider } : {}),
    ...(issue.modelId !== undefined ? { modelId: issue.modelId } : {}),
    ...(issue.field !== undefined ? { field: issue.field } : {}),
  };
}

/**
 * Build the doctor summary from a normalized catalog.
 *
 * Verdict / exit semantics:
 * - malformed rows (incl. active-but-incomplete) => blocked, exit 1 always.
 * - structurally valid but placeholders present (or empty) => attention_required;
 *   exit 0 by default (the initial catalog is intentionally all placeholders),
 *   exit 1 only under --strict.
 * - structurally valid, no placeholders, >= 1 active row => ready, exit 0.
 */
export function buildSummary(normalized, { strict }) {
  const { counts, issues, structurallyValid, routable, active, placeholders } = normalized;
  const placeholderCount = placeholders.length;
  const malformedCount = counts.malformed;
  const activeCount = active.length;
  const isEmpty = counts.total === 0;

  const failureCodes = [];
  const advisoryCodes = [];
  let verdict;

  if (malformedCount > 0) {
    verdict = 'blocked';
    failureCodes.push('model_catalog_malformed');
  } else if (placeholderCount > 0) {
    verdict = 'attention_required';
    advisoryCodes.push('model_catalog_placeholders');
  } else if (isEmpty) {
    verdict = 'attention_required';
    advisoryCodes.push('model_catalog_empty');
  } else {
    verdict = 'ready';
  }

  // Under --strict, an otherwise-acceptable advisory state is escalated to a
  // blocking failure so CI can refuse a catalog that is not fully routable.
  if (strict && verdict === 'attention_required') {
    verdict = 'blocked';
    if (placeholderCount > 0) failureCodes.push('model_catalog_placeholders');
    if (isEmpty) failureCodes.push('model_catalog_empty');
  }

  const message = buildMessage({ verdict, counts, activeCount, placeholderCount, malformedCount, isEmpty, strict });

  return {
    schemaVersion: DOCTOR_SCHEMA_VERSION,
    kind: KIND,
    strict,
    verdict,
    ok: verdict === 'ready',
    failureCodes,
    advisoryCodes,
    message,
    version: normalized.version,
    counts,
    structurallyValid,
    routable,
    issues: issues.map(describeIssue),
    activeModels: active.map((entry) => ({ provider: entry.provider, modelId: entry.modelId, tier: entry.tier })),
    placeholderModels: placeholders.map((entry) => ({
      provider: entry.provider ?? null,
      modelId: entry.modelId ?? null,
    })),
  };
}

function buildMessage({ counts, activeCount, placeholderCount, malformedCount, isEmpty }) {
  if (isEmpty) {
    return 'Model catalog has no entries.';
  }

  const head = `${counts.total} ${counts.total === 1 ? 'entry' : 'entries'}: ` +
    `${activeCount} active, ${placeholderCount} placeholder, ${malformedCount} malformed`;

  if (malformedCount > 0) {
    return `${head} — catalog blocked (fix malformed rows).`;
  }
  if (placeholderCount > 0) {
    return `${head} — not yet routable (fill placeholder rows and set status=active).`;
  }
  return `${head} — routable.`;
}

export function buildFailureSummary(code, message, { strict }) {
  return {
    schemaVersion: DOCTOR_SCHEMA_VERSION,
    kind: KIND,
    strict,
    verdict: 'blocked',
    ok: false,
    failureCodes: [code],
    advisoryCodes: [],
    message,
    version: null,
    counts: { total: 0, active: 0, placeholder: 0, malformed: 0 },
    structurallyValid: false,
    routable: false,
    issues: [],
    activeModels: [],
    placeholderModels: [],
    error: message,
  };
}

function printSummary(summary) {
  console.log('Model catalog doctor:');
  console.log(`  verdict: ${summary.verdict}`);
  console.log(`  message: ${summary.message}`);
  if (summary.failureCodes.length > 0) {
    console.log(`  failureCodes: ${summary.failureCodes.join(', ')}`);
  }
  if (summary.advisoryCodes.length > 0) {
    console.log(`  advisoryCodes: ${summary.advisoryCodes.join(', ')}`);
  }
  if (summary.version !== null) {
    console.log(`  catalog version: ${summary.version}`);
  }
  console.log(
    `  counts: total=${summary.counts.total} active=${summary.counts.active} ` +
      `placeholder=${summary.counts.placeholder} malformed=${summary.counts.malformed}`,
  );
  console.log(`  routable: ${summary.routable}`);
  for (const issue of summary.issues) {
    console.log(`  [${issue.kind}] ${issue.message}`);
  }
}

function parseArgs(argv) {
  let json = false;
  let strict = false;
  let catalogPath = DEFAULT_CATALOG_PATH;

  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') {
      json = true;
    } else if (arg === '--strict') {
      strict = true;
    } else if (arg === '--catalog') {
      const next = args[i + 1];
      if (!next) {
        throw new Error('Usage: node scripts/model-catalog-doctor.mjs [--catalog <path>] [--strict] [--json]');
      }
      catalogPath = path.resolve(repoRoot, next);
      i += 1;
    } else if (arg.startsWith('--catalog=')) {
      catalogPath = path.resolve(repoRoot, arg.slice('--catalog='.length));
    } else {
      throw new Error('Usage: node scripts/model-catalog-doctor.mjs [--catalog <path>] [--strict] [--json]');
    }
  }

  return { json, strict, catalogPath };
}

let summaryJsonPrinted = false;

async function main(options) {
  const { json, strict, catalogPath } = options;
  const { parseCatalog, normalizeCatalog } = await loadCatalogModule();

  const data = await readCatalogFile(catalogPath);

  let normalized;
  try {
    normalized = normalizeCatalog(parseCatalog(data));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CatalogDoctorError('model_catalog_invalid', detail);
  }

  const summary = buildSummary(normalized, { strict });

  if (json) {
    console.log(JSON.stringify(summary));
    summaryJsonPrinted = true;
  } else {
    printSummary(summary);
  }

  if (summary.verdict === 'blocked') {
    process.exitCode = 1;
  }
}

const isDirectExecution = process.argv[1] != null
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  let options;
  try {
    options = parseArgs(process.argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    options = null;
  }

  if (options) {
    main(options).catch((error) => {
      const code = error instanceof CatalogDoctorError ? error.code : 'model_catalog_unreadable';
      const message = error instanceof Error ? error.message : String(error);
      const summary = buildFailureSummary(code, message, { strict: options.strict });
      if (options.json && !summaryJsonPrinted) {
        console.log(JSON.stringify(summary));
      } else if (!options.json) {
        printSummary(summary);
      }
      process.stderr.write(`${summary.message}\n`);
      process.exitCode = 1;
    });
  }
}
