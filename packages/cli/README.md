# @cogitatum/cli

Check Cogitatum inquiry markup and inspect the reasoning connections marked in ordinary prose.

Public Alpha source release: **0.3.0-alpha.1**, format **0.3.0**. Installation from npm becomes available after publication. Requires Node.js 22.12 or newer.

From a source checkout:

```sh
npm ci
npm run build:public
npm exec -- cog check examples/getting-started.cog.md
npm exec -- cog graph examples/getting-started.cog.md
```

`check` reports syntax and reference diagnostics; `ast` and `graph` print JSON projections. Use `--input host` for mixed Markdown with `cog` fences. Exit status is 0 for success, 1 for source or I/O errors, and 2 for invalid arguments. Diagnostics check the markup, not whether the reasoning succeeds.

For debugging a note, `cog explain inquiry.cog.md` prints an optional Alpha compiler trace: recognition, emitted or rejected points and connections, and the compilation rules involved. This command explains how the markup was compiled. It does not explain the prose or evaluate an argument.

Read the [quick start](https://cogitatum.baksili.codes/docs/quick-start), browse [examples](https://cogitatum.baksili.codes/examples), or try the [playground](https://cogitatum.baksili.codes/playground).
