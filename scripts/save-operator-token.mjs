import { chmod, mkdir, stat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultOperatorTokenFile } from './operator-token-path.mjs';

export const saveOperatorTokenUsage =
  'Usage: node scripts/save-operator-token.mjs [--file /secure/path/operator-token] [--rotate] [--print]';

export function parseArgs(argv) {
  let rotate = false;
  let print = false;
  let file;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--rotate') {
      rotate = true;
      continue;
    }

    if (arg === '--print') {
      print = true;
      continue;
    }

    if (arg === '--file') {
      const next = argv[index + 1];
      if (!next || next.startsWith('--') || file) {
        throw new Error(saveOperatorTokenUsage);
      }
      file = next;
      index += 1;
      continue;
    }

    throw new Error(saveOperatorTokenUsage);
  }

  return {
    rotate,
    print,
    file: file ?? defaultOperatorTokenFile,
  };
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = randomBytes(32).toString('hex');
  const tokenDirectory = path.dirname(args.file);

  await mkdir(tokenDirectory, { recursive: true, mode: 0o700 });
  if (path.basename(tokenDirectory) === '.switchboard') {
    await chmod(tokenDirectory, 0o700);
  }

  if (!args.rotate && await fileExists(args.file)) {
    throw new Error(`Operator token file already exists at ${args.file}. Re-run with --rotate to replace it.`);
  }

  await writeFile(args.file, `${token}\n`, { mode: 0o600 });
  await chmod(args.file, 0o600);

  console.log(`Saved Switchboard operator token to ${args.file}`);
  console.log('File permissions were set to owner-only access.');
  if (args.print) {
    console.log(`Token: ${token}`);
  } else {
    console.log('Token value was not printed. Use --print only if you explicitly need to copy it once.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to save operator token: ${message}`);
    process.exitCode = 1;
  });
}
