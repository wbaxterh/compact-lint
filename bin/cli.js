#!/usr/bin/env node
import { lintPaths } from '../src/index.js';

const USAGE = `compact-lint - static analysis for Compact contracts on Midnight

Usage:
  compact-lint [options] <path...>

Options:
  --json          Emit findings as JSON.
  --quiet         Only print errors (hide warnings and review items).
  --max-severity  Exit non-zero at or above this level: error (default), warning, review.
  -h, --help      Show this help.

Exit codes:
  0  no findings at or above the failure threshold
  1  findings found
  2  bad usage or no input

Rules:
  unbound-witness-path   A witness-supplied MerkleTreePath reaches checkRoot without
                         an assert binding path.leaf to the recomputed value, so the
                         check proves some leaf is in the tree rather than yours.
`;

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (COLOR ? `[${code}m${s}[0m` : s);
const RANK = { error: 3, warning: 2, review: 1 };
const LABEL = {
  error: paint(31, 'error'),
  warning: paint(33, 'warning'),
  review: paint(36, 'review'),
};

async function main(argv) {
  const paths = [];
  let json = false;
  let quiet = false;
  let threshold = 'error';

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      process.stdout.write(USAGE);
      return 0;
    } else if (a === '--json') json = true;
    else if (a === '--quiet') quiet = true;
    else if (a === '--max-severity') {
      threshold = argv[++i];
      if (!RANK[threshold]) {
        process.stderr.write(`compact-lint: unknown severity '${threshold}'\n`);
        return 2;
      }
    } else if (a.startsWith('-')) {
      process.stderr.write(`compact-lint: unknown option '${a}'\n`);
      return 2;
    } else paths.push(a);
  }

  if (paths.length === 0) {
    process.stderr.write(USAGE);
    return 2;
  }

  let result;
  try {
    result = await lintPaths(paths);
  } catch (err) {
    process.stderr.write(`compact-lint: ${err.message}\n`);
    return 2;
  }

  const { files, findings } = result;

  if (json) {
    process.stdout.write(JSON.stringify({ files: files.length, findings }, null, 2) + '\n');
  } else {
    const shown = quiet ? findings.filter((f) => f.severity === 'error') : findings;

    for (const f of shown) {
      process.stdout.write(
        `${paint(4, `${f.file}:${f.line}`)}  ${LABEL[f.severity]}  ${paint(2, f.rule)}\n` +
          `  circuit ${f.circuit}${f.exported ? ' (exported)' : ''}, path '${f.path}'` +
          `${f.origin ? ` from ${f.origin}` : ''}\n` +
          `  ${f.message}\n\n`
      );
    }

    const counts = { error: 0, warning: 0, review: 0 };
    for (const f of findings) counts[f.severity]++;

    const summary =
      findings.length === 0
        ? paint(32, 'no findings')
        : `${counts.error} error, ${counts.warning} warning, ${counts.review} review`;
    process.stdout.write(
      `Scanned ${files.length} file${files.length === 1 ? '' : 's'}. ${summary}.\n`
    );
  }

  return findings.some((f) => RANK[f.severity] >= RANK[threshold]) ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`compact-lint: ${err.stack || err}\n`);
    process.exit(2);
  }
);
