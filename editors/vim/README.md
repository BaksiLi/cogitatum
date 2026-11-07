# Cogitatum for Vim

Filetype detection, syntax highlighting and an [ALE](https://github.com/dense-analysis/ale) linter for Cogitatum inquiry source.
Requires Vim 8.2 or newer; the linter needs ALE and the `cog` CLI.

## Install

With vim-plug, load this directory from the repository:

```vim
Plug 'BaksiLi/cogitatum', { 'rtp': 'editors/vim' }
```

Files ending in `.cog.md` or `.cog` open with the `cogitatum` filetype.
To highlight `cog` fences inside ordinary Markdown notes, add them to Vim's Markdown syntax:

```vim
let g:markdown_fenced_languages = ['cog=cogitatum']
```

## Language server

Enable the `cog` linter, which runs [`cog lsp`](../../packages/cli/README.md#editor-integration):

```vim
let g:ale_linters = { 'cogitatum': ['cog'], 'markdown': ['cog'] }
```

ALE then shows diagnostics while you type.
`:ALEGoToDefinition`, `:ALEFindReferences`, `:ALEHover` and `:ALERename` work on `@name` tokens once the source has no errors.
In Markdown notes the server reads `cog` fences only; notes without fences receive no diagnostics.

The linter uses a project's `node_modules/.bin/cog`, then `cog` on `PATH`.
Set `g:ale_cogitatum_cog_executable` to use another CLI, for example a source checkout's `packages/cli/dist/index.js`.
