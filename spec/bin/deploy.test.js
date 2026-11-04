import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const deployScript = path.resolve(import.meta.dirname, '../../bin/deploy');

const fakeCurl = `#!/bin/bash
for arg in "$@"; do
  printf '%s\\n' "$arg" >> "$FAKE_CURL_LOG"
done
echo "fake curl response body"
if [ -n "$FAKE_CURL_STDERR" ]; then
  echo "$FAKE_CURL_STDERR" >&2
fi
exit \${FAKE_CURL_EXIT:-0}
`;

describe('bin/deploy', () => {
  let tmpDir;
  let logFile;

  const runDeploy = (args, env = {}) =>
    spawnSync('bash', [deployScript, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${tmpDir}:${process.env.PATH}`,
        FAKE_CURL_LOG: logFile,
        DEPLOY_URL: 'https://example.com/build-hook',
        DEPLOY_TRIGGER: 'test',
        ...env,
      },
    });

  const curlArgs = () =>
    existsSync(logFile)
      ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean)
      : [];

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'deploy-test-'));
    logFile = path.join(tmpDir, 'curl-args.log');
    writeFileSync(path.join(tmpDir, 'curl'), fakeCurl, { mode: 0o755 });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('production deployment', () => {
    it('should exit with 0 when the build hook request succeeds', () => {
      const result = runDeploy(['production']);

      expect(result.status).toBe(0);
    });

    it('should print a correctly spelled success message', () => {
      const result = runDeploy(['production']);

      expect(result.stdout).toContain("Deploying from 'master' branch...");
      expect(result.stdout).toContain('Deployment successful\n');
      expect(result.stdout).not.toContain('successfull');
    });

    it('should exit with a non-zero status when the build hook request fails', () => {
      const result = runDeploy(['production'], { FAKE_CURL_EXIT: '22' });

      expect(result.status).not.toBe(0);
    });

    it('should print a failure message when the build hook request fails', () => {
      const result = runDeploy(['production'], { FAKE_CURL_EXIT: '22' });

      expect(result.stdout).toContain('Deployment failed');
      expect(result.stdout).not.toContain('Deployment successful');
    });

    it('should call curl with fail, silent and show-error flags', () => {
      runDeploy(['production']);

      const args = curlArgs();
      expect(args[0]).toBe('-fsS');
      expect(args).toContain('-X');
      expect(args).toContain('POST');
    });

    it('should send the master branch and the deploy url to curl', () => {
      runDeploy(['production']);

      const args = curlArgs();
      expect(args).toContain('trigger_branch=master');
      expect(args).toContain('https://example.com/build-hook');
      expect(
        args.some(
          arg =>
            arg.startsWith('trigger_title=[') &&
            arg.endsWith('] Deployment: test')
        )
      ).toBe(true);
    });

    it('should surface curl errors on stderr', () => {
      const result = runDeploy(['production'], {
        FAKE_CURL_EXIT: '22',
        FAKE_CURL_STDERR: 'curl: (22) The requested URL returned error: 500',
      });

      expect(result.stderr).toContain(
        'curl: (22) The requested URL returned error: 500'
      );
    });

    it('should not print the build hook response body', () => {
      const result = runDeploy(['production']);

      expect(result.stdout).not.toContain('fake curl response body');
      expect(result.stderr).not.toContain('fake curl response body');
    });
  });

  describe('unknown environment', () => {
    it('should abort and exit with a non-zero status', () => {
      const result = runDeploy(['staging']);

      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain('Unknown environment: staging');
      expect(result.stdout).toContain('Deployment aborted');
    });

    it('should not call curl', () => {
      runDeploy(['staging']);

      expect(curlArgs()).toEqual([]);
    });
  });
});
