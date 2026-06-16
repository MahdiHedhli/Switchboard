import { promises as fs } from 'node:fs';
import type { ProviderId } from '@switchboard/core';
import { normalizeCatalog, parseCatalog } from '@switchboard/core';
import type { DashboardCatalog } from './dashboard.js';

/**
 * Load + normalize the on-disk model catalog into the routable shape the
 * dashboard/selector consume. The catalog is the single source of truth for
 * what may be routed on; only `active` rows are routable, and `placeholders`
 * feed the selector's `selection_placeholder_skipped` hint.
 *
 * Degrades to an EMPTY catalog on any read/parse/validation error so a missing
 * or malformed catalog can never prevent the broker from starting — selection
 * simply becomes a structural no-op until the catalog is fixed.
 */
export async function loadDashboardCatalog(catalogPath: string): Promise<DashboardCatalog> {
  try {
    const raw = await fs.readFile(catalogPath, 'utf8');
    const normalized = normalizeCatalog(parseCatalog(JSON.parse(raw)));
    return {
      active: normalized.active,
      placeholders: normalized.placeholders
        .filter((entry) => typeof entry.provider === 'string' && typeof entry.modelId === 'string')
        .map((entry) => ({ provider: entry.provider as ProviderId, modelId: entry.modelId as string })),
    };
  } catch {
    return { active: [], placeholders: [] };
  }
}
