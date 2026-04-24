import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const fixturesRoot = path.join(repoRoot, 'fixtures', 'profile-loader');
const {
  buildUnknownProjectProfileDetail,
  resolveBrokerProjectProfile,
} = await import(path.join(repoRoot, 'apps/broker/dist/index.js'));

const validDir = path.join(fixturesRoot, 'valid', 'single');

assert.equal(buildUnknownProjectProfileDetail('missing-profile'), 'Unknown project profile "missing-profile".');

const found = await resolveBrokerProjectProfile(validDir, 'fixture-valid');
assert.equal(found.ok, true);
assert.equal(found.profile?.id, 'fixture-valid');
assert.equal(found.payload, undefined);

const missing = await resolveBrokerProjectProfile(validDir, 'missing-profile');
assert.deepEqual(missing, {
  ok: false,
  statusCode: 404,
  payload: {
    error: 'not_found',
    detail: 'Unknown project profile "missing-profile".',
  },
});

console.log('Profile resolution smoke test passed.');
