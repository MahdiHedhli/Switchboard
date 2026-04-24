import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { buildLocalBrokerEnvironment, repoRoot } from './local-broker-launch.mjs';

const brokerEntry = path.join(repoRoot, 'apps/broker/dist/index.js');
export const defaultLocalOpenaiRefreshCommandNotice =
  'Switchboard local broker is using the default reviewed OpenAI refresh command because no explicit OpenAI adapter env or sanitized openai.json snapshot was found.';

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

async function main() {
  const { env, inferredOpenaiRefreshCommand } = await buildLocalBrokerEnvironment(process.env);

  if (inferredOpenaiRefreshCommand) {
    console.log(defaultLocalOpenaiRefreshCommandNotice);
  }

  const child = spawn(process.execPath, [brokerEntry], {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  });

  child.once('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exitCode = code ?? 0;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
  });
}
