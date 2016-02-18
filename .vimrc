set nocompatible              " be iMproved, required
filetype off                  " required

" set the runtime path to include Vundle and initialize
set rtp+=~/.vim/bundle/Vundle.vim
call vundle#begin()
" alternatively, pass a path where Vundle should install plugins
"call vundle#begin('~/some/path/here')

" let Vundle manage Vundle, required
Plugin 'gmarik/Vundle.vim'

" The following are examples of different formats supported.
" Keep Plugin commands between vundle#begin/end.
" plugin on GitHub repo
Plugin 'tpope/vim-fugitive'
" plugin from http://vim-scripts.org/vim/scripts.html
Plugin 'L9'
" Git plugin not hosted on GitHub
Plugin 'git://git.wincent.com/command-t.git'
" git repos on your local machine (i.e. when working on your own plugin)
Plugin 'file:///home/gmarik/path/to/plugin'
" The sparkup vim script is in a subdirectory of this repo called vim.
" Pass the path to set the runtimepath properly.
Plugin 'rstacruz/sparkup', {'rtp': 'vim/'}
" Avoid a name conflict with L9
" Plugin 'user/L9', {'name': 'newL9'}

" vim-arline tab and status bar
Plugin 'bling/vim-airline'
" JSON Syntax Highlighting
Plugin 'elzr/vim-json'
" syntastic syntax checking
Plugin 'scrooloose/syntastic'
" vim-gitgutter highlight changes in a git repo
Plugin 'airblade/vim-gitgutter'
" Color Scheme
Plugin 'flazz/vim-colorschemes'
" Nerd Tree On The Left
Plugin 'scrooloose/nerdtree'
Plugin 'jistr/vim-nerdtree-tabs'
Plugin 'Xuyuanp/nerdtree-git-plugin'
" Git Conflict Resolution
Plugin 'christoomey/vim-conflicted'

Plugin 'vim-scripts/bash-support.vim'
Plugin 'arecarn/selection.vim'
Plugin 'vim-ruby/vim-ruby'
Plugin 'tpope/vim-rails'
Plugin 'tpope/vim-cucumber'
Plugin 'tfnico/vim-gradle'
Plugin 'stephpy/vim-yaml'
Plugin 'elixir-lang/vim-elixir'
Plugin 'pangloss/vim-javascript'
Plugin 'mxw/vim-jsx'
Plugin 'kchmck/vim-coffee-script'
Plugin 'rking/ag.vim'
Plugin 'kien/ctrlp.vim'

" All of your Plugins must be added before the following line
call vundle#end()            " required
filetype plugin indent on    " required
" To ignore plugin indent changes, instead use:
"filetype plugin on
"
" Brief help
" :PluginList       - lists configured plugins
" :PluginInstall    - installs plugins; append `!` to update or just :PluginUpdate
" :PluginSearch foo - searches for foo; append `!` to refresh local cache
" :PluginClean      - confirms removal of unused plugins; append `!` to auto-approve removal
"
" see :h vundle for more details or wiki for FAQ
" Put your non-Plugin stuff after this line


"Syntax Highlighting
syntax on

set number
set relativenumber
set ruler
set smartindent
set showcmd
set visualbell

" Git Gutter
let g:gitgutter_eager = 1
let g:gitgutter_realtime = 1

" Airline
set laststatus=2
set timeoutlen=50
let g:airline_theme='wombat'

" Color Scheme
set background=dark
colorscheme badwolf

" NERDTree
autocmd vimenter * NERDTree
autocmd bufenter * if (winnr("$") == 1 && exists("b:NERDTreeType") && b:NERDTreeType == "primary") | q | endif
autocmd VimEnter * wincmd p
let NERDTreeShowHidden=1

" 2 spaces indent
set tabstop=2 shiftwidth=2 softtabstop=2

" Toggle paste mode
set pastetoggle=<F2>

set autoread

" make backspace work like most other apps
set backspace=2 

autocmd FileType ruby,eruby let g:rubycomplete_buffer_loading = 1 
autocmd FileType ruby,eruby let g:rubycomplete_classes_in_global = 1
autocmd FileType ruby,eruby let g:rubycomplete_rails = 1

map <F7> mzgg=G`z

if executable('ag')
	" Note we extract the column as well as the file and line number
	set grepprg=ag\ --nogroup\ --nocolor\ --column
	set grepformat=%f:%l:%c%m
endif
nnoremap K :Ag! "\b<C-R><C-W>\b"<CR>:cw<CR>
