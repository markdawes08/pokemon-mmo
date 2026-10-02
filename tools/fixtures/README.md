# Independent fixture storage

The registered generated literals are stored as deterministic `.json.gz`
archives. Decompression returns the exact former JSON bytes, including CRLF
line endings. `manifest.json` pins archive bytes, canonical bytes and case counts.
Existing retained hashes continue to identify canonical JSON, never gzip bytes.
The small original battle-spike batch fixtures remain plain JSON.
Each entry also lists the canonical fixture's `sourceRecords` paths so the
verification catalog can hash oracle-only source dependencies. Storage checks
verify this metadata against the pinned canonical contents.

`io.ts` and `fixture_io.py` are test-only IO helpers. They enforce the registered
allowlist, pinned hashes and bounded decompression. Unknown fixture paths fail.
`readRetainedBytes` additionally permits ordinary WASM files for existing mixed
retained-artifact checks. Runtime engines do not depend on these helpers.

Run each existing generator with `--check` to independently derive its expected
cases and compare them with the canonical archive contents. No expectations are
obtained from production code. Running the generator without `--check` writes
the same deterministic archive (gzip level 9, empty filename, mtime zero).
Intentional oracle changes require reviewing and updating that fixture's manifest
pins before regeneration; regeneration cannot silently replace a retained pin.
Archive reproducibility uses the installed Python/zlib toolchain; canonical JSON
identity is independent of compression implementation.

`node --import tsx tools/fixtures/check.ts` validates every archive through Node,
checks case identities/counts and exercises corruption, output-limit and unknown
path rejection. `python tools/fixtures/check.py` independently checks Python
loading and deterministic compression. These are storage checks, not substitutes
for source-oracle reproduction or mechanics/recovery gates.
