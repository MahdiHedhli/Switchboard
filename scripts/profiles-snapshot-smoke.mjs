import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const { buildProjectProfilesSnapshot } = await import(path.join(repoRoot, 'apps/broker/dist/index.js'));

const snapshot = buildProjectProfilesSnapshot([
  {
    id: 'threatpedia',
    name: 'Threatpedia',
    description: 'Discovery and triage workflow.',
    repos: [
      {
        id: 'main',
        path: '/workspace/threatpedia',
        visibility: 'private',
        role: 'working',
      },
    ],
    roles: [
      {
        id: 'kernel-proxy',
        name: 'Kernel Proxy',
        provider: 'openai',
        defaultModelId: 'codex',
        responsibilities: ['Plan work', 'Review diffs'],
        canWrite: true,
        canReview: true,
        canApprove: true,
      },
    ],
  },
  {
    id: 'vedetta',
    name: 'Vedetta',
    description: 'DNS-first security monitoring.',
    repos: [
      {
        id: 'site',
        path: '/workspace/vedetta',
        visibility: 'public',
        role: 'publish',
      },
    ],
    roles: [
      {
        id: 'intel-reviewer',
        name: 'Intel Reviewer',
        provider: 'anthropic',
        defaultModelId: 'claude-sonnet',
        responsibilities: ['Verify public copy'],
        canWrite: false,
        canReview: true,
        canApprove: false,
      },
    ],
  },
]);

assert.deepEqual(snapshot, {
  profiles: [
    {
      id: 'threatpedia',
      name: 'Threatpedia',
      description: 'Discovery and triage workflow.',
      repoCount: 1,
      roleCount: 1,
    },
    {
      id: 'vedetta',
      name: 'Vedetta',
      description: 'DNS-first security monitoring.',
      repoCount: 1,
      roleCount: 1,
    },
  ],
});

const serialized = JSON.stringify(snapshot);
assert.equal(serialized.includes('/workspace/'), false);
assert.equal(serialized.includes('defaultModelId'), false);
assert.equal(serialized.includes('responsibilities'), false);
assert.equal('repos' in snapshot.profiles[0], false);
assert.equal('roles' in snapshot.profiles[0], false);

console.log('Profiles snapshot smoke test passed.');
