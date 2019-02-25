set nocompatible     " Be iMproved
set shell=zsh        " Same shell I normally use

" Set leader to space
let mapleader = "\<Space>"


" Required:
set runtimepath+=~/.vim/bundle/repos/github.com/Shougo/dein.vim

if &compatible
  set nocompatible
endif
set runtimepath+=~/.vim/bundle/repos/github.com/Shougo/dein.vim

" Required:
call dein#begin('/Users/sam/.dein')

" Let dein manage dein
" Required:
call dein#add('Shougo/dein.vim')


"""""""""""""""
" Custom Stuff
"""""""""""""""

let s:vimconfigs = "~/code/dotfiles/"
call dein#load_toml(s:vimconfigs . ".vimrc_config.toml")
call dein#load_toml(s:vimconfigs . ".vimrc_general.toml")
call dein#load_toml(s:vimconfigs . ".vimrc_display.toml")
call dein#load_toml(s:vimconfigs . ".vimrc_language_text.toml")
call dein#load_toml(s:vimconfigs . ".vimrc_language_ruby.toml")
call dein#load_toml(s:vimconfigs . ".vimrc_language_elixir.toml")
call dein#load_toml(s:vimconfigs . ".vimrc_language_javascript.toml")
call dein#load_toml(s:vimconfigs . ".vimrc_language_haskell.toml")
call dein#load_toml(s:vimconfigs . ".vimrc_platform_web.toml")

"""""""""""""""""""
" End Custom Stuff
""""""""""""""""""

" If you want to install not installed plugins on startup.
if dein#check_install()
call dein#install()
endif

" Required:
call dein#end()

filetype plugin indent on
syntax enable
