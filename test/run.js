import { lintFile } from '../src/index.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures');

const cases = [
  {
    file: 'unbound.compact',
    want: [{ severity: 'error', circuit: 'claim', path: 'path', source: 'witness' }],
    why: 'witness-derived path reaching checkRoot with no binding assert',
  },
  {
    file: 'bound.compact',
    want: [],
    why: 'assert(path.leaf == c) present, so nothing to report',
  },
  {
    file: 'comment-decoy.compact',
    want: [{ severity: 'error', circuit: 'revoke', path: 'authPath', source: 'witness' }],
    why: 'the only binding assert is inside comments, which must not count',
  },
  {
    file: 'param-path.compact',
    want: [{ severity: 'warning', circuit: 'verify', path: 'path', source: 'parameter' }],
    why: 'caller-supplied path on an exported circuit, and nested generics must parse',
  },
  {
    file: 'no-checkroot.compact',
    want: [],
    why: 'merkleTreePathRoot without checkRoot is not an authorization decision',
  },
];

let failed = 0;

for (const c of cases) {
  const got = await lintFile(join(FIX, c.file));
  const problems = [];

  if (got.length !== c.want.length) {
    problems.push(`expected ${c.want.length} finding(s), got ${got.length}`);
  }

  c.want.forEach((w, i) => {
    const g = got[i];
    if (!g) {
      problems.push(`missing finding ${i}`);
      return;
    }
    for (const k of Object.keys(w)) {
      if (g[k] !== w[k]) problems.push(`finding ${i}: ${k} expected '${w[k]}', got '${g[k]}'`);
    }
    if (!Number.isInteger(g.line) || g.line < 1) {
      problems.push(`finding ${i}: bad line number '${g.line}'`);
    }
  });

  if (problems.length) {
    failed++;
    console.log(`FAIL  ${c.file}  (${c.why})`);
    for (const p of problems) console.log(`        ${p}`);
    console.log(`        got: ${JSON.stringify(got, null, 2)}`);
  } else {
    const detail = got.length ? `${got[0].severity} at line ${got[0].line}` : 'clean';
    console.log(`ok    ${c.file}  ${detail}`);
  }
}

console.log();
if (failed) {
  console.log(`${failed} of ${cases.length} failed`);
  process.exit(1);
}
console.log(`all ${cases.length} passed`);
