" Cogitatum inquiry source: a restricted Markdown-style outline whose bullet
" headers may carry one bracketed annotation.
if exists('b:current_syntax')
  finish
endif

syntax case match

" Annotations are recognized only at the start of a bullet's content.
syntax match cogBullet /^\s*-\ze\s/ nextgroup=cogHeader skipwhite
syntax region cogHeader matchgroup=cogBracket start=/\[/ end=/\]/ oneline contained
      \ contains=cogClaim,cogGround,cogObjection,cogReply,cogQuestion,cogDefinition,cogFamily,cogKeyword,cogOperator,cogRetired,cogName,cogTarget,cogSeparator

" A mark is a whole token: it follows the bracket or a space and ends the
" token at whitespace, a separator, a reference or the closing bracket.
let s:start = '\%(\[\|\s\)\@1<='
let s:end = '\%([[:space:];@\]]\|$\)\@='
execute 'syntax match cogClaim /'.s:start.'C[?/]\?'.s:end.'/ contained'
execute 'syntax match cogGround /'.s:start.'G[?/]\?'.s:end.'/ contained'
execute 'syntax match cogObjection /'.s:start.'O[?/]\?'.s:end.'/ contained'
execute 'syntax match cogReply /'.s:start.'R[?/]\?'.s:end.'/ contained'
execute 'syntax match cogQuestion /'.s:start.'Q[?/]\?'.s:end.'/ contained'
execute 'syntax match cogDefinition /'.s:start.'D[?/]\?'.s:end.'/ contained'
execute 'syntax match cogFamily /'.s:start.'\%(\.\|_\/\?\|point\|node\|bearing\|edge\)'.s:end.'/ contained'
execute 'syntax match cogKeyword /'.s:start.'\%(use\|note\)'.s:end.'/ contained'
execute 'syntax match cogOperator /'.s:start.'\%(+>\|->\|\~>\|supports\|challenges\|concerns\|answers\|respondsTo\|clarifies\)'.s:end.'/ contained'
" Retired spellings compile to diagnosed boundaries; show them before compiling.
execute 'syntax match cogRetired /'.s:start.'\%(\/>\|_>\|about\|repliesTo\|undercuts\|linked\|join\)'.s:end.'/ contained'
unlet s:start s:end

syntax match cogName /@[a-z][a-z0-9_-]*/ contained
syntax match cogTarget /\^\/\?/ contained
syntax match cogSeparator /;/ contained

syntax match cogCode /`[^`]\+`/

highlight default link cogBullet Delimiter
highlight default link cogBracket Delimiter
highlight default link cogClaim Statement
highlight default link cogGround Type
highlight default link cogObjection Special
highlight default link cogReply PreProc
highlight default link cogQuestion Constant
highlight default link cogDefinition Function
highlight default link cogFamily Operator
highlight default link cogKeyword Keyword
highlight default link cogOperator Operator
highlight default link cogRetired Error
highlight default link cogName Identifier
highlight default link cogTarget Special
highlight default link cogSeparator Delimiter
highlight default link cogCode String

let b:current_syntax = 'cogitatum'
