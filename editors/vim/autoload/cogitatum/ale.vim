" Shared by the cogitatum and markdown ALE linters: both run `cog lsp`, which
" selects document or host input from the file name.

" Prefer a project's installed CLI, as ALE does for other Node tools.
function! cogitatum#ale#Executable(buffer) abort
  return ale#path#FindExecutable(a:buffer, 'cogitatum_cog', ['node_modules/.bin/cog'])
endfunction

" Names never cross files, so the file's directory is a sufficient root.
function! cogitatum#ale#ProjectRoot(buffer) abort
  return fnamemodify(bufname(a:buffer), ':p:h')
endfunction

function! cogitatum#ale#Define(filetype) abort
  call ale#Set('cogitatum_cog_executable', 'cog')
  call ale#Set('cogitatum_cog_use_global', get(g:, 'ale_use_global_executables', 0))
  call ale#linter#Define(a:filetype, {
        \ 'name': 'cog',
        \ 'lsp': 'stdio',
        \ 'executable': function('cogitatum#ale#Executable'),
        \ 'command': '%e lsp',
        \ 'project_root': function('cogitatum#ale#ProjectRoot'),
        \ 'language': a:filetype,
        \ })
endfunction
