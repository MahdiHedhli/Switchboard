import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function createRuntimeSecurityFixtures(prefix = 'switchboard-runtime-fixtures-') {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  const tokenFile = path.join(root, 'operator-token');
  const certFile = path.join(root, 'fixture-cert.pem');
  const keyFile = path.join(root, 'fixture-key.pem');

  await writeFile(tokenFile, 'reviewed-remote-token\n', { mode: 0o600 });
  await writeFile(certFile, '-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n', { mode: 0o644 });
  await writeFile(keyFile, '-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----\n', { mode: 0o600 });

  return {
    root,
    tokenFile,
    certFile,
    keyFile,
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

export async function createSelfSignedTlsFixture(prefix = 'switchboard-runtime-tls-') {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  const keyFile = path.join(root, 'tls-key.pem');
  const certFile = path.join(root, 'tls-cert.pem');
  const configFile = path.join(root, 'openssl.cnf');

  await writeFile(
    configFile,
    `[req]
distinguished_name=req_distinguished_name
x509_extensions=v3_req
prompt=no

[req_distinguished_name]
CN=localhost

[v3_req]
subjectAltName=@alt_names

[alt_names]
DNS.1=localhost
IP.1=127.0.0.1
IP.2=0.0.0.0
IP.3=::1
`,
    { mode: 0o600 },
  );

  await execFileAsync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-keyout',
    keyFile,
    '-out',
    certFile,
    '-days',
    '7',
    '-nodes',
    '-config',
    configFile,
    '-extensions',
    'v3_req',
  ]);

  return {
    root,
    certFile,
    keyFile,
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}
