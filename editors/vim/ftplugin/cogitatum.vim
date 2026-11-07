if exists('b:did_ftplugin')
  finish
endif
let b:did_ftplugin = 1

" Outline blocks continue with spaces under their bullet text, and one source
" unit keeps one indentation character.
setlocal expandtab shiftwidth=2 softtabstop=2
setlocal comments=fb:- formatoptions+=ro formatoptions-=t
let b:undo_ftplugin = 'setlocal expandtab< shiftwidth< softtabstop< comments< formatoptions<'
