import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blankComments, blankCommentsAndStrings } from '../src/parse.js';
import { lintText } from '../src/index.js';

test('masking non-code keeps offsets and line endings, including UTF-16 surrogate pairs', () => {
  const source = 'const x = "🔒 path.leaf == c";\r\n// note\r\n/* more\ntext */\nassert(true, "}");';
  const masked = blankCommentsAndStrings(source);

  assert.equal(masked.length, source.length);
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n' || source[i] === '\r') assert.equal(masked[i], source[i]);
  }
  assert.equal(masked.indexOf('assert'), source.indexOf('assert'));
  assert.equal(masked.includes('leaf'), false);
  assert.equal(masked.includes('}'), false);
});

test('escaped quotes do not end a literal and comment delimiters inside it do not start comments', () => {
  const literal = String.raw`"escaped \" quote // /* } path.leaf == c"`;
  const source = `assert(true, ${literal});\nconst real = 1;`;
  const masked = blankCommentsAndStrings(source);

  assert.equal(masked, `assert(true, ${' '.repeat(literal.length)});\nconst real = 1;`);
  assert.equal(blankComments(source), source);
});

test('escaped backslashes do not swallow the closing quote or following code', () => {
  const literal = String.raw`"trailing slash \\"`;
  const source = `const label = ${literal}; assert(true, "ok");`;

  assert.equal(
    blankCommentsAndStrings(source),
    `const label = ${' '.repeat(literal.length)}; assert(true, ${' '.repeat(4)});`
  );
});

test('single-quoted strings and escaped line endings are masked without losing line positions', () => {
  const source = "const label = 'ignore \\' }';\nconst next = \"continued\\\nstring\";\nconst real = 1;";
  const masked = blankCommentsAndStrings(source);

  assert.equal(masked.length, source.length);
  assert.equal(masked.split('\n').length, source.split('\n').length);
  assert.equal(masked.includes('ignore'), false);
  assert.equal(masked.includes('continued'), false);
  assert.equal(masked.includes('string'), false);
  assert.equal(masked.indexOf('const real'), source.indexOf('const real'));
});

test('quotes inside comments do not hide executable code and blankComments retains strings', () => {
  const source = '/* " */ const a = "https://example.test/*text*/"; // \'\nconst b = 2;';
  const comments = blankComments(source);
  const masked = blankCommentsAndStrings(source);

  assert.ok(comments.includes('"https://example.test/*text*/"'));
  assert.ok(masked.includes('const a = '));
  assert.ok(masked.endsWith('\nconst b = 2;'));
  assert.equal(masked.includes('https'), false);
});

test('string decoys preserve the finding offset with CRLF and Unicode before the check', () => {
  const source = [
    'witness findPath(): MerkleTreePath<10, Bytes<32>>;',
    'export circuit claim(): [] {',
    '  const path = findPath();',
    '  assert(true, "🔒 } assert(path.leaf == c)");',
    '  assert(tree.checkRoot(merkleTreePathRoot<10, Bytes<32>>(disclose(path))), "not a member");',
    '}',
  ].join('\r\n');
  const findings = lintText(source);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 5);
  assert.equal(findings[0].severity, 'error');
  assert.equal(findings[0].circuit, 'claim');
});
