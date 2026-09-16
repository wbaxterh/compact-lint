import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname, sep } from 'node:path';
import { blankComments } from './parse.js';
import * as unboundWitnessPath from './rules/unbound-witness-path.js';

export const rules = [unboundWitnessPath];

/** Lint a string of Compact source. */
export function lintText(src, filename = '<input>') {
  const text = blankComments(src);
  const findings = [];
  for (const rule of rules) findings.push(...rule.run(src, text, filename));
  return findings;
}

/** Lint one file. Paths are reported with forward slashes on every platform. */
export async function lintFile(path) {
  const src = await readFile(path, 'utf8');
  return lintText(src, path.split(sep).join('/'));
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'managed', 'target']);

/** Recursively collect .compact files under a file or directory path. */
export async function collect(path) {
  const info = await stat(path);
  if (info.isFile()) return extname(path) === '.compact' ? [path] : [];

  const found = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      found.push(...(await collect(join(path, entry.name))));
    } else if (extname(entry.name) === '.compact') {
      found.push(join(path, entry.name));
    }
  }
  return found;
}

/** Lint every .compact file under the given paths. */
export async function lintPaths(paths) {
  const files = [];
  for (const p of paths) files.push(...(await collect(p)));

  const findings = [];
  for (const f of files.sort()) findings.push(...(await lintFile(f)));

  return { files, findings };
}
