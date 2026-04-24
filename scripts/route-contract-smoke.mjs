import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const {
  allowedMethodsForBrokerRoute,
  matchBrokerRoute,
} = await import(path.join(repoRoot, 'apps/broker/dist/index.js'));

assert.deepEqual(matchBrokerRoute('/healthz'), { kind: 'health' });
assert.deepEqual(allowedMethodsForBrokerRoute({ kind: 'health' }), ['GET']);

assert.deepEqual(matchBrokerRoute('/v1/profiles'), { kind: 'profiles' });
assert.deepEqual(allowedMethodsForBrokerRoute({ kind: 'profiles' }), ['GET']);

assert.deepEqual(matchBrokerRoute('/v1/projects/threatpedia/state'), {
  kind: 'project-state',
  profileId: 'threatpedia',
});
assert.deepEqual(matchBrokerRoute('/v1/projects/threatpedia/dashboard'), {
  kind: 'project-dashboard',
  profileId: 'threatpedia',
});
assert.deepEqual(matchBrokerRoute('/v1/projects/threatpedia/adapters'), {
  kind: 'project-adapters',
  profileId: 'threatpedia',
});

assert.deepEqual(matchBrokerRoute('/v1/projects/threatpedia/tasks'), {
  kind: 'project-tasks',
  profileId: 'threatpedia',
});
assert.deepEqual(allowedMethodsForBrokerRoute({ kind: 'project-tasks', profileId: 'threatpedia' }), ['POST']);

assert.deepEqual(matchBrokerRoute('/v1/projects/threatpedia/tasks/TASK-0001'), {
  kind: 'project-task',
  profileId: 'threatpedia',
  taskId: 'TASK-0001',
});
assert.deepEqual(
  allowedMethodsForBrokerRoute({ kind: 'project-task', profileId: 'threatpedia', taskId: 'TASK-0001' }),
  ['GET', 'PATCH'],
);

assert.deepEqual(matchBrokerRoute('/v1/projects/threatpedia/subscriptions'), {
  kind: 'project-subscriptions',
  profileId: 'threatpedia',
});
assert.deepEqual(
  allowedMethodsForBrokerRoute({ kind: 'project-subscriptions', profileId: 'threatpedia' }),
  ['PUT'],
);

assert.deepEqual(matchBrokerRoute('/v1/projects/threatpedia/subscriptions/refresh'), {
  kind: 'project-subscriptions-refresh',
  profileId: 'threatpedia',
});
assert.deepEqual(
  allowedMethodsForBrokerRoute({ kind: 'project-subscriptions-refresh', profileId: 'threatpedia' }),
  ['POST'],
);

assert.equal(matchBrokerRoute('/v1/projects/threatpedia'), null);
assert.equal(matchBrokerRoute('/v1/projects/threatpedia/tasks/TASK-0001/extra'), null);
assert.equal(matchBrokerRoute('/v1/projects/threatpedia/subscriptions/refresh/extra'), null);
assert.equal(matchBrokerRoute('/v1/projects/threatpedia/subscriptions/reset'), null);
assert.equal(matchBrokerRoute('/v1/projects/threatpedia/unknown'), null);
assert.equal(matchBrokerRoute('/v1/projects'), null);
assert.equal(matchBrokerRoute('/nope'), null);

console.log('Route contract smoke test passed.');
