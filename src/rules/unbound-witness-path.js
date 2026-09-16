/**
 * Rule: unbound-witness-path
 *
 * A Merkle membership check proves that SOME leaf is in the tree. It only proves
 * that YOUR leaf is in the tree if the circuit also asserts that the path's own
 * leaf equals the value the circuit recomputed.
 *
 *   const c    = commitmentFor(secret());          // recomputed in-circuit
 *   const path = findPath(c);                      // witness, unconstrained
 *   assert(tree.checkRoot(merkleTreePathRoot<10, Bytes<32>>(disclose(path))), "..");
 *
 * `MerkleTreePath` carries its own `leaf` field and `merkleTreePathRoot` hashes
 * that leaf, never `c`. Witness returns are chosen by the prover and every path in
 * the tree is public ledger state, so any member's path satisfies any caller's
 * check. The remedy is one assert:
 *
 *   assert(path.leaf == c, "path is not for this commitment");
 *
 * Both forms compile and are well-typed, which is why this needs a linter.
 */

import { callParenAfter, balancedArg, lineOf, splitCircuits, findWitnesses } from '../parse.js';

export const meta = {
  name: 'unbound-witness-path',
  docs: 'https://github.com/wbaxterh/compact-lint#unbound-witness-path',
};

/** Parameter names declared by a circuit, e.g. "a: Bytes<32>, p: MerkleTreePath<10, X>". */
function paramNames(params) {
  const names = new Set();
  let depth = 0;
  let current = '';
  const parts = [];

  for (const ch of params) {
    if (ch === '<' || ch === '(' || ch === '[') depth++;
    else if (ch === '>' || ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);

  for (const p of parts) {
    const m = p.match(/^\s*([A-Za-z_]\w*)\s*:/);
    if (m) names.add(m[1]);
  }
  return names;
}

export function run(src, text, filename) {
  const witnesses = findWitnesses(text);
  const findings = [];

  for (const circuit of splitCircuits(text)) {
    // Only look at membership checks used as a gate. A merkleTreePathRoot call with
    // no checkRoot in the same circuit is not an authorization decision.
    if (!circuit.body.includes('checkRoot')) continue;

    const params = paramNames(circuit.params);
    const re = /\bmerkleTreePathRoot\b/g;
    let m;

    while ((m = re.exec(circuit.body)) !== null) {
      const open = callParenAfter(circuit.body, m.index + m[0].length);
      if (open === -1) continue;

      const rawArg = balancedArg(circuit.body, open).trim();

      // unwrap a single disclose(...) wrapper
      let expr = rawArg;
      const dm = expr.match(/^disclose\s*\(([\s\S]*)\)\s*$/);
      if (dm) expr = dm[1].trim();

      const base = expr.split(/[.[\s,(]/)[0];
      if (!base || !/^[A-Za-z_]\w*$/.test(base)) continue;

      // How was `base` produced inside this circuit?
      let origin = null;
      let source = 'unknown';

      const decl = circuit.body.match(
        new RegExp(`\\b(?:const|let)\\s+${base}\\s*(?::[^=]+)?=\\s*([^;]+);`)
      );

      if (decl) {
        const rhs = decl[1].trim();
        origin = rhs.slice(0, 100);
        const callee = rhs.match(/^([A-Za-z_]\w*)\s*(?:<[\s\S]*?>)?\s*\(/);
        if (callee) {
          source = witnesses.has(callee[1]) ? 'witness' : 'call';
        } else if (/^[A-Za-z_]\w*$/.test(rhs)) {
          source = witnesses.has(rhs) ? 'witness' : 'alias';
        } else {
          source = 'expression';
        }
      } else if (params.has(base)) {
        origin = `circuit parameter of ${circuit.name}`;
        source = 'parameter';
      }

      // Is the path bound to a recomputed value anywhere in this circuit?
      const bound =
        new RegExp(`\\b${base}\\s*\\.\\s*leaf\\s*==`).test(circuit.body) ||
        new RegExp(`==\\s*${base}\\s*\\.\\s*leaf\\b`).test(circuit.body);

      if (bound) continue;

      let severity = null;
      let message = null;

      if (source === 'witness') {
        severity = 'error';
        message =
          `'${base}' comes from a witness and reaches checkRoot without being bound to a leaf. ` +
          `A prover can return any member's path here. Add: assert(${base}.leaf == <recomputed value>, "path is not for this value");`;
      } else if (source === 'parameter' && circuit.exported) {
        severity = 'warning';
        message =
          `'${base}' is a parameter of exported circuit '${circuit.name}' and reaches checkRoot unbound. ` +
          `The caller chooses it, so this proves membership of whatever path was passed in. ` +
          `Bind it: assert(${base}.leaf == <recomputed value>, "path is not for this value");`;
      } else if (source === 'unknown' || source === 'expression' || source === 'alias') {
        severity = 'review';
        message =
          `Could not determine where '${base}' comes from, and it reaches checkRoot unbound. ` +
          `If it is witness-derived or caller-supplied this is an authorization bypass. Review by hand.`;
      } else {
        // source === 'call' to a non-witness function: likely computed in-circuit, so
        // the path is constrained by the proof. Not reported.
        continue;
      }

      const offset = circuit.bodyStart + m.index;
      findings.push({
        rule: meta.name,
        severity,
        file: filename,
        line: lineOf(src, offset),
        circuit: circuit.name,
        exported: circuit.exported,
        path: base,
        source,
        origin,
        message,
      });
    }
  }

  return findings;
}
