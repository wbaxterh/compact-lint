import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

test('the CLI exits with a finding for a string-only binding decoy', () => {
  const result = spawnSync(process.execPath, [cli, '--json', fixture('string-decoy.compact')], { encoding: 'utf8' });

  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.files, 1);
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].severity, 'error');
  assert.equal(report.findings[0].line, 12);
});

test('the CLI stays clean for a real binding after a string containing a closing brace', () => {
  const result = spawnSync(process.execPath, [cli, '--json', fixture('string-brace-bound.compact')], { encoding: 'utf8' });

  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { files: 1, findings: [] });
});
