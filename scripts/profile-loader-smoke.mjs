import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const fixturesRoot = path.join(repoRoot, 'fixtures', 'profile-loader');
const { loadProjectProfile, loadProjectProfiles } = await import(path.join(repoRoot, 'apps/broker/dist/profile-loader.js'));

async function expectLoaderFailure(name, directory, expectedMessageFragment) {
  await assert.rejects(
    loadProjectProfiles(directory),
    (error) => {
      assert(error instanceof Error);
      assert.match(error.message, new RegExp(expectedMessageFragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.equal(error.message.includes(fixturesRoot), false);
      assert.equal(error.message.includes('/Users/'), false);
      return true;
    },
    `${name} should have failed with ${expectedMessageFragment}`,
  );
}

const validDir = path.join(fixturesRoot, 'valid', 'single');
const validProfiles = await loadProjectProfiles(validDir);
assert.equal(validProfiles.length, 1);
assert.equal(validProfiles[0].id, 'fixture-valid');
assert.equal(validProfiles[0].repos.length, 1);
assert.equal(validProfiles[0].roles.length, 1);

const loadedProfile = await loadProjectProfile(validDir, 'fixture-valid');
assert.notEqual(loadedProfile, null);
assert.equal(loadedProfile?.roles[0]?.responsibilities[0], 'routing');

const missingProfile = await loadProjectProfile(validDir, 'does-not-exist');
assert.equal(missingProfile, null);

await expectLoaderFailure(
  'duplicate-role-id',
  path.join(fixturesRoot, 'invalid', 'duplicate-role-id'),
  'contains duplicate id "operator"',
);
await expectLoaderFailure(
  'unknown-profile-key',
  path.join(fixturesRoot, 'invalid', 'unknown-profile-key'),
  '.workflow is not allowed.',
);
await expectLoaderFailure(
  'unknown-repo-key',
  path.join(fixturesRoot, 'invalid', 'unknown-repo-key'),
  '.repos[0].branch is not allowed.',
);
await expectLoaderFailure(
  'empty-roles',
  path.join(fixturesRoot, 'invalid', 'empty-roles'),
  '.roles must contain at least one entry.',
);
await expectLoaderFailure(
  'empty-responsibilities',
  path.join(fixturesRoot, 'invalid', 'empty-responsibilities'),
  '.roles[0].responsibilities must contain at least one entry.',
);
await expectLoaderFailure(
  'duplicate-profile-id',
  path.join(fixturesRoot, 'invalid', 'duplicate-profile-id'),
  'profiles contains duplicate id "fixture-duplicate-profile".',
);

console.log('Profile loader smoke test passed.');
