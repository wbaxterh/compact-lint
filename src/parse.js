/**
 * Minimal structural parsing for Compact source.
 *
 * This is deliberately not a full parser. It does the least work needed to answer
 * "which circuit is this call site in, and where did its arguments come from",
 * and it reports anything it cannot resolve rather than guessing.
 */

/**
 * Replace comments, and optionally string literals, with spaces instead of deleting them.
 *
 * Every JavaScript string offset and line number matches the original,
 * which is what lets findings carry real line numbers. String literals are tracked
 * so that a `//` inside a string is not mistaken for a comment.
 */
function blankNonCode(src, strings) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  let state = 'code';
  let quote = '';

  while (i < n) {
    const c = src[i];
    const d = i + 1 < n ? src[i + 1] : '';

    if (state === 'code') {
      if (c === '/' && d === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
        state = 'line';
        continue;
      }
      if (c === '/' && d === '*') {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
        state = 'block';
        continue;
      }
      if (c === '"' || c === "'") {
        quote = c;
        if (strings) out[i] = ' ';
        state = 'string';
        i++;
        continue;
      }
      i++;
      continue;
    }

    if (state === 'line') {
      if (c === '\n' || c === '\r') {
        state = 'code';
        i++;
        continue;
      }
      out[i] = ' ';
      i++;
      continue;
    }

    if (state === 'block') {
      if (c === '*' && d === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
        state = 'code';
        continue;
      }
      if (c !== '\n' && c !== '\r') out[i] = ' ';
      i++;
      continue;
    }

    // string
    if (c === '\\') {
      if (strings) {
        out[i] = ' ';
        if (i + 1 < n && d !== '\n' && d !== '\r') out[i + 1] = ' ';
      }
      i += 2;
      continue;
    }
    if (strings && c !== '\n' && c !== '\r') out[i] = ' ';
    if (c === quote) {
      state = 'code';
      i++;
      continue;
    }
    i++;
  }

  return out.join('');
}

/** Blank comments while retaining string literals, including their delimiters. */
export function blankComments(src) {
  return blankNonCode(src, false);
}

/** Blank comments and strings so structural parsing sees only code, without shifting offsets. */
export function blankCommentsAndStrings(src) {
  return blankNonCode(src, true);
}

/** 1-based line number for a JavaScript string offset. */
export function lineOf(src, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src[i] === '\n') line++;
  }
  return line;
}

/** Names of all top-level `witness foo(...)` declarations. */
export function findWitnesses(text) {
  const names = new Set();
  const re = /\bwitness\s+([A-Za-z_]\w*)\s*\(/g;
  let m;
  while ((m = re.exec(text)) !== null) names.add(m[1]);
  return names;
}

/**
 * Walk forward from the end of an identifier to the `(` that opens its argument
 * list, stepping over an optional generic argument list.
 *
 * Nested generics are the whole reason this is not a regex. A pattern like
 * `<[^>]*>` stops at the inner `>` of `Bytes<32>`, which silently skips most real
 * call sites. Depth counting is what makes `merkleTreePathRoot<10, Bytes<32>>(p)`
 * resolve correctly.
 */
export function callParenAfter(text, identEnd) {
  let i = identEnd;
  while (i < text.length && /\s/.test(text[i])) i++;

  if (text[i] === '<') {
    let depth = 0;
    while (i < text.length) {
      if (text[i] === '<') depth++;
      else if (text[i] === '>') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
      i++;
    }
    while (i < text.length && /\s/.test(text[i])) i++;
  }

  return text[i] === '(' ? i : -1;
}

/** Inner text of the balanced parenthesised group starting at `open`. */
export function balancedArg(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return '';
}

/**
 * Every circuit in the file, located by brace matching.
 * Returns `{ name, exported, params, body, bodyStart }` where `bodyStart` is the
 * absolute offset of the body's opening brace.
 */
export function splitCircuits(text) {
  const out = [];
  const re = /\b(export\s+)?circuit\s+([A-Za-z_]\w*)/g;
  let m;

  while ((m = re.exec(text)) !== null) {
    const exported = Boolean(m[1]);
    const name = m[2];

    const open = callParenAfter(text, m.index + m[0].length);
    if (open === -1) continue;
    const params = balancedArg(text, open);

    // step past the argument list, then past the return type, to the body brace
    let i = open;
    let depth = 0;
    for (; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }

    const brace = text.indexOf('{', i);
    if (brace === -1) continue;

    let bdepth = 0;
    let j = brace;
    for (; j < text.length; j++) {
      if (text[j] === '{') bdepth++;
      else if (text[j] === '}') {
        bdepth--;
        if (bdepth === 0) {
          j++;
          break;
        }
      }
    }

    out.push({
      name,
      exported,
      params,
      body: text.slice(brace, j),
      bodyStart: brace,
    });
  }

  return out;
}
