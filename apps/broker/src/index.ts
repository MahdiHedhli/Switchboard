import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describeBrokerOrigin } from './runtime-config.js';
import { createBrokerServerFromEnvironment } from './server.js';

async function main(): Promise<void> {
  const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const { config, server } = await createBrokerServerFromEnvironment({
    profilesDir: process.env.SWITCHBOARD_PROFILES_DIR ?? path.join(repoRoot, 'profiles'),
    stateDir: process.env.SWITCHBOARD_STATE_DIR ?? path.join(repoRoot, '.switchboard', 'state'),
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => resolve());
  });

  console.log(`Switchboard broker listening on ${describeBrokerOrigin(config.summary)}`);
}

export * from './adapters/registry.js';
export * from './adapters/types.js';
export * from './adapter-conflict.js';
export * from './adapters-snapshot.js';
export * from './auth-policy.js';
export * from './dashboard.js';
export * from './error-response.js';
export * from './error-http-response.js';
export * from './failure-response.js';
export * from './health.js';
export * from './mutation-authorization.js';
export * from './planner.js';
export * from './profile-loader.js';
export * from './profile-resolution.js';
export * from './profiles-snapshot.js';
export * from './refresh.js';
export * from './refresh-snapshot.js';
export * from './request-body.js';
export * from './response-envelope.js';
export * from './route-contract.js';
export * from './runtime-config.js';
export * from './server.js';
export * from './state-snapshot.js';
export * from './state-store.js';
export * from './task-snapshot.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to start broker: ${message}`);
    process.exitCode = 1;
  });
}
