import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';

const shell = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'sh';
const shellArgs = process.platform === 'win32'
  ? ['--noprofile', '--norc', 'docker/entrypoint.sh']
  : ['docker/entrypoint.sh'];
const temporaryDirectories: string[] = [];

function generateRuntimeConfig(
  connectionString = '',
  samplingPercentage?: string,
): Record<string, unknown> {
  const directory = mkdtempSync(join(process.cwd(), '.runtime-config-test-'));
  temporaryDirectories.push(directory);
  const output = relative(process.cwd(), join(directory, 'runtime-config.js')).split(sep).join('/');

  execFileSync(shell, [...shellArgs, output], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      API_URL: 'https://api.example/api/v1',
      APPLICATIONINSIGHTS_CONNECTION_STRING: connectionString,
      APPLICATIONINSIGHTS_BROWSER_SAMPLING_PERCENTAGE: samplingPercentage ?? '',
    },
  });

  const runtimeConfig: { __APP_CONFIG__?: Record<string, unknown> } = {};
  runInNewContext(readFileSync(join(process.cwd(), output), 'utf8'), {
    window: runtimeConfig,
    atob: (encoded: string) => Buffer.from(encoded, 'base64').toString('binary'),
  });
  return runtimeConfig.__APP_CONFIG__ ?? {};
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('container runtime config generation', () => {
  it('preserves the existing API config when telemetry is not configured', () => {
    expect(generateRuntimeConfig()).toEqual({
      apiUrl: 'https://api.example/api/v1',
    });
  });

  it('safely encodes configured telemetry strings instead of inserting executable text', () => {
    const connectionString = 'InstrumentationKey=public-key;IngestionEndpoint=https://ingest.example';
    const config = generateRuntimeConfig(connectionString, '37.5');

    expect(config).toEqual({
      apiUrl: 'https://api.example/api/v1',
      applicationInsightsConnectionString: connectionString,
      applicationInsightsSamplingPercentage: 37.5,
    });
  });

  it('defaults configured browser telemetry sampling to 100 percent', () => {
    expect(generateRuntimeConfig('InstrumentationKey=public-key')).toEqual({
      apiUrl: 'https://api.example/api/v1',
      applicationInsightsConnectionString: 'InstrumentationKey=public-key',
      applicationInsightsSamplingPercentage: 100,
    });
  });

  it.each(['0', '100.01', '-1', 'NaN', 'Infinity', '1e9999'])(
    'rejects invalid browser sampling percentage %s',
    (samplingPercentage) => {
      expect(() => generateRuntimeConfig('InstrumentationKey=public-key', samplingPercentage))
        .toThrow();
    },
  );

  it('rejects telemetry config characters that cannot be represented safely', () => {
    const directory = mkdtempSync(join(process.cwd(), '.runtime-config-test-'));
    temporaryDirectories.push(directory);
    const output = relative(process.cwd(), join(directory, 'runtime-config.js')).split(sep).join('/');

    expect(() => execFileSync(shell, [...shellArgs, output], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        API_URL: 'https://api.example/api/v1',
        APPLICATIONINSIGHTS_CONNECTION_STRING: 'InstrumentationKey=x";alert(1)//',
      },
      stdio: 'pipe',
    })).toThrow();
  });
});
