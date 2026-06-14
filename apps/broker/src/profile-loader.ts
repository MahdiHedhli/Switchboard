import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AgentRole, ProjectProfile } from '@switchboard/core';
import {
  assertKnownKeys,
  expectArray,
  expectBoolean,
  expectEnum,
  expectIdentifier,
  expectRecord,
  expectString,
  expectStringArray,
} from './validation.js';

const repoVisibilities = ['public', 'private'] as const;
const repoRoles = ['working', 'publish', 'mixed'] as const;

function parseRepo(value: unknown, context: string): ProjectProfile['repos'][number] {
  const record = expectRecord(value, context);
  assertKnownKeys(record, ['id', 'path', 'visibility', 'role'], context);

  return {
    id: expectIdentifier(record.id, `${context}.id`),
    path: expectString(record.path, `${context}.path`),
    visibility: expectEnum(record.visibility, repoVisibilities, `${context}.visibility`),
    role: expectEnum(record.role, repoRoles, `${context}.role`),
  };
}

function parseRole(value: unknown, context: string): AgentRole {
  const record = expectRecord(value, context);
  assertKnownKeys(
    record,
    ['id', 'name', 'provider', 'defaultModelId', 'responsibilities', 'canWrite', 'canReview', 'canApprove'],
    context,
  );
  const responsibilities = expectStringArray(record.responsibilities, `${context}.responsibilities`);
  if (responsibilities.length === 0) {
    throw new Error(`${context}.responsibilities must contain at least one entry.`);
  }

  return {
    id: expectIdentifier(record.id, `${context}.id`),
    name: expectString(record.name, `${context}.name`),
    provider: expectString(record.provider, `${context}.provider`),
    defaultModelId: expectString(record.defaultModelId, `${context}.defaultModelId`),
    responsibilities,
    canWrite: expectBoolean(record.canWrite, `${context}.canWrite`),
    canReview: expectBoolean(record.canReview, `${context}.canReview`),
    canApprove: expectBoolean(record.canApprove, `${context}.canApprove`),
  };
}

function ensureUniqueIds(entries: Array<{ id: string }>, context: string): void {
  const seen = new Set<string>();

  for (const entry of entries) {
    if (seen.has(entry.id)) {
      throw new Error(`${context} contains duplicate id "${entry.id}".`);
    }

    seen.add(entry.id);
  }
}

function ensureNonEmpty(entries: unknown[], context: string): void {
  if (entries.length === 0) {
    throw new Error(`${context} must contain at least one entry.`);
  }
}

function parseProfile(raw: unknown, source: string): ProjectProfile {
  const record = expectRecord(raw, source);
  assertKnownKeys(record, ['id', 'name', 'description', 'repos', 'roles'], source);
  const repos = expectArray(record.repos, `${source}.repos`).map((entry, index) =>
    parseRepo(entry, `${source}.repos[${index}]`),
  );
  const roles = expectArray(record.roles, `${source}.roles`).map((entry, index) =>
    parseRole(entry, `${source}.roles[${index}]`),
  );

  ensureNonEmpty(repos, `${source}.repos`);
  ensureNonEmpty(roles, `${source}.roles`);
  ensureUniqueIds(repos, `${source}.repos`);
  ensureUniqueIds(roles, `${source}.roles`);

  return {
    id: expectIdentifier(record.id, `${source}.id`),
    name: expectString(record.name, `${source}.name`),
    description: expectString(record.description, `${source}.description`),
    repos,
    roles,
  };
}

export async function loadProjectProfiles(profilesDir: string): Promise<ProjectProfile[]> {
  const directoryEntries = await fs.readdir(profilesDir, { withFileTypes: true });
  const files = directoryEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const profiles = await Promise.all(
    files.map(async (fileName) => {
      const filePath = path.join(profilesDir, fileName);
      const raw = await fs.readFile(filePath, 'utf8');
      return parseProfile(JSON.parse(raw), `profile ${fileName}`);
    }),
  );

  ensureUniqueIds(profiles, 'profiles');
  return profiles;
}

export async function loadProjectProfile(profilesDir: string, profileId: string): Promise<ProjectProfile | null> {
  const profiles = await loadProjectProfiles(profilesDir);
  return profiles.find((profile) => profile.id === profileId) ?? null;
}
