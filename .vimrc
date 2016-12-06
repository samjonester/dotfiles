set nocompatible               " Be iMproved

" Set leader to space
let mapleader = "\<Space>"


" Required:
set runtimepath+=/Users/sam/.dien/repos/github.com/Shougo/dein.vim


" Required:
call dein#begin('/Users/sam/.dien')

" Let dein manage dein
" Required:
call dein#add('Shougo/dein.vim')


"""""""""""""""
" Custom Stuff
"""""""""""""""

let s:vimconfigs = "~/code/dotfiles/"
call dein#load_toml(s:vimconfigs . ".vimrc_config.toml")
call dein#load_toml(s:vimconfigs . ".vimrc_display.toml")
call dein#load_toml(s:vimconfigs . ".vimrc_general.toml")
call dein#load_toml(s:vimconfigs . ".vimrc_language_text.toml")
call dein#load_toml(s:vimconfigs . ".vimrc_language_ruby.toml")
call dein#load_toml(s:vimconfigs . ".vimrc_language_javascript.toml")
call dein#load_toml(s:vimconfigs . ".vimrc_language_haskell.toml")

"""""""""""""""""""
" End Custom Stuff
""""""""""""""""""


" You can specify revision/branch/tag.
call dein#add('Shougo/vimshell', { 'rev': '3787e5' })

" Required:
filetype plugin indent on
syntax enable
"
" If you want to install not installed plugins on startup.
if dein#check_install()
  call dein#install()
endif

" Required:
call dein#end()
