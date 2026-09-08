# Language conformance fixtures

Each case specifies observable behavior of the current language: an input, its mode, a concrete purpose, and a reviewed expected result. These are compiler tests. The prose in a case is test data; compiling it does not validate its claims, interpretations, or inference method.

`manifest.json` registers each input and its adjacent `.expected.json` file. Run `npx vitest run packages/core/src/fixtures.test.ts` from the repository root. Run the complete checks before release; fixtures complement parser, schema, CLI, and compiler-trace tests.

| Directory | What it tests |
| --- | --- |
| `core/` | Body boundaries, naming, connection topology, and reference resolution |
| `syntax/` | Annotation and indentation rules, including deliberately absent connections |
| `diagnostics/` | Invalid or suspicious input, severity, location, and surviving graph structure |
| `host/` | Fence selection, unit isolation, and locations in the host document |

Expected results compare the selected input mode, the full ordered diagnostics list, and every graph's complete ordered Point and Bearing lists. Points retain their form, role, authored name, and open status. Bearings retain their kind, source list, target kind, derivation mechanism, and authored handle. An empty list means no such output is permitted; a diagnostic alone is not enough to pass a rejection case.

The `line` fields identify the start line in the input file, including host-file line numbers. Bearing `sources` are Point line numbers. A target is `{ "kind": "point" | "bearing", "line": number }`. This fixture-only notation makes topology reviewable without freezing generated keys, prefixes, or numbering. It is not another public compiler format. References are resolved through each actual graph before comparison. Diagnostic messages, full spans, text preservation, and raw compiler output are checked by focused tests where relevant rather than copied into every expectation.

Write the purpose and expected behavior from the syntax reference before checking the compiler. When a mismatch appears, decide whether the implementation, reference, or expectation is wrong; do not regenerate expectations from current output simply to make tests pass. If a change deliberately alters the language contract, update the reference and relevant tests together and consider the format version.

Add a small case for a distinct rule or failure mode. Keep realistic writing demonstrations in `examples/`. Keep speculative semantics, proposed features, evaluation criteria, and research datasets outside this conformance corpus. Names should describe what the assertions establish: a one-compilation reference test does not establish stability across revisions, and a support topology does not establish logical validity.
