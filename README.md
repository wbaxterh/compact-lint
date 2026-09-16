# compact-lint

Static analysis for [Compact](https://docs.midnight.network) smart contracts on Midnight.

It finds a soundness bug that compiles cleanly, type checks, and passes every honest test:
a witness-supplied Merkle path that reaches `checkRoot` without ever being bound to the leaf
the circuit recomputed.

```
npx compact-lint contract/src
```

## The bug it finds

Merkle membership is the standard way to prove a caller belongs to an authorized set:

```compact
export circuit claim(): [] {
  const sk   = secretKey();                        // witness
  const c    = commitmentFor(sk);                  // recomputed in-circuit
  const path = findPath(c);                        // witness, unconstrained
  assert(items.checkRoot(merkleTreePathRoot<10, Bytes<32>>(disclose(path))), "not a member");
}
```

This looks right and is not. `MerkleTreePath` carries its own `leaf` field, and
`merkleTreePathRoot` hashes **that** leaf, never `c`. The recomputation and the check are
connected by nothing at all.

Witness functions run unconstrained on the prover's machine, and every leaf and path in the
tree is public ledger state. So a caller who is not a member can take any genuinely inserted
leaf, rebuild its path from public data, return it from their own witness implementation, and
pass the check. `checkRoot` alone proves that *some* leaf is in the tree, not that *yours* is.

The fix is one line:

```compact
  assert(path.leaf == c, "path is not for this commitment");
```

The failure is silent in exactly the wrong direction. An honest caller's witness returns their
own path, `path.leaf` equals `c` anyway, and every test passes. The defect only appears when
someone deliberately supplies a path for a leaf that is not theirs, which is to say when it is
being exploited.

## Install

```sh
npm install -g compact-lint     # or: npx compact-lint <path>
```

No dependencies. Node 18 or newer.

## Usage

```sh
compact-lint contract/src              # scan a directory, recursively
compact-lint a.compact b.compact       # or specific files
compact-lint --json contract/src       # machine-readable
compact-lint --quiet contract/src      # errors only
compact-lint --max-severity review .   # fail CI on review items too
```

Exit codes: `0` clean, `1` findings at or above the failure threshold (default `error`),
`2` bad usage.

In CI:

```yaml
- run: npx compact-lint contract/src
```

## Rules

### `unbound-witness-path`

Reports a `merkleTreePathRoot` call whose path argument reaches a `checkRoot` in the same
circuit with no `assert(<path>.leaf == ...)` binding it.

| Severity | Meaning |
| --- | --- |
| `error` | The path is returned by a `witness` function. The prover chooses it outright. |
| `warning` | The path is a parameter of an **exported** circuit, so the caller chooses it. |
| `review` | The path's origin could not be resolved. Check it by hand. |

Paths produced by ordinary in-circuit calls are not reported, because the proof constrains
them.

## What this tool does not claim

A finding is not automatically a vulnerability, and this matters if you are counting.

A membership check can be perfectly safe when the leaf is public rather than witness-derived,
when the index is known and fixed, or when `checkRoot` is not load bearing for authorization
in the first place. `review` findings exist because the analyzer would rather admit it cannot
resolve something than quietly classify it.

The analyzer is structural, not semantic. It resolves a path variable back to its defining
statement inside the same circuit. It does not do interprocedural analysis, so a path laundered
through a helper circuit will land in `review` rather than `error`.

Treat the output as a list of call sites to read, not as a verdict.

## Accuracy

Validated against real contracts with known-correct behaviour, including OpenZeppelin's
`ShieldedAccessControl`, which binds its path correctly and comments the attack it prevents.
compact-lint reports it clean across 837 lines.

The test suite covers the correct form, the unbound form, a caller-supplied path, a
`merkleTreePathRoot` used outside any authorization decision, and a decoy where the only
binding assert sits inside comments.

```sh
npm test
```

One parser note worth repeating for anyone writing similar tooling. Matching a generic call
with `<[^>]*>` breaks on nested generics: the character class stops at the inner `>` of
`Bytes<32>`, silently skipping most real call sites. compact-lint locates the identifier and
then scans forward with depth counting instead. An earlier survey using the naive pattern
undercounted call sites by more than an order of magnitude.

## Background

This rule came out of a survey of 122 `checkRoot` call sites across 63 public repositories,
written up as a Midnight Problem Statement on witness-supplied Merkle path binding
([midnight-improvement-proposals#311](https://github.com/midnightntwrk/midnight-improvement-proposals/pull/311)).
The same gap was fixed in Midnight's own `keeping-data-private` documentation in
[midnight-docs#1314](https://github.com/midnightntwrk/midnight-docs/pull/1314).

The pattern the survey found: teams who know about this bind and comment it, and everyone else
writes the unbound form, because the safe and unsafe versions are visually identical and the
compiler accepts both. That is a tooling gap, which is what this tool exists to close.

## Contributing

Issues and pull requests welcome, particularly false positives and false negatives. A failing
fixture in `test/fixtures/` is the most useful bug report.

## License

Apache-2.0
