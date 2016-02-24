filetype off                  " required

" set the runtime path to include Vundle and initialize
set rtp+=~/.vim/bundle/Vundle.vim
call vundle#begin()
" alternatively, pass a path where Vundle should install plugins
"call vundle#begin('~/some/path/here')

" let Vundle manage Vundle, required
Plugin 'gmarik/Vundle.vim'

" Git :Gblame, :Gdiff, :Gbrowse, :Gstatus
Plugin 'tpope/vim-fugitive'
" Plugin directory organization
Plugin 'L9'
" vim-arline tab and status bar
Plugin 'bling/vim-airline'
" json syntax highlighting
Plugin 'elzr/vim-json'
" Syntax error highlighting
Plugin 'scrooloose/syntastic'
" Git gutter to show git differences
Plugin 'airblade/vim-gitgutter'
" Colorschemes
Plugin 'flazz/vim-colorschemes'
" NERDTree project file browser bar
Plugin 'scrooloose/nerdtree'
" Highlight git in nerdtree
Plugin 'Xuyuanp/nerdtree-git-plugin'
" Bash syntax
Plugin 'vim-scripts/bash-support.vim'
" Ruby goodness
Plugin 'vim-ruby/vim-ruby'
" Rails goodness
Plugin 'tpope/vim-rails'
" Bundler goodness
Plugin 'tpope/vim-bundler'
" Cucumber syntax highlighting <C-W><C-d> to find glue
Plugin 'tpope/vim-cucumber'
" Gradle syntax highlighting
Plugin 'tfnico/vim-gradle'
" Yaml syntax highlighting
Plugin 'stephpy/vim-yaml'
" Elixir syntax highlighting
Plugin 'elixir-lang/vim-elixir'
" JavaScript syntax highlighting
Plugin 'pangloss/vim-javascript'
" JavScript JSX Syntax highlighting
Plugin 'mxw/vim-jsx'
" CoffeeScript syntax highlighting
Plugin 'kchmck/vim-coffee-script'
" ctrlP File opener
Plugin 'kien/ctrlp.vim'
" Silver searcher
Plugin 'rking/ag.vim'
" Silver search * search
Plugin 'Chun-Yang/vim-action-ag'
" Run rspecs
Plugin 'thoughtbot/vim-rspec'
" End blocks properly
Plugin 'tpope/vim-endwise'
" Unix commands
Plugin 'tpope/vim-eunuch'
" Comment Toggle
Plugin 'vim-scripts/tComment'
" Change Surround
Plugin 'tpope/vim-surround'
" Supertab
Plugin 'ervandew/supertab'
" Better auto completion
Plugin 'Valloric/YouCompleteMe'
" UltiSnips
Plugin 'SirVer/ultisnips'
" Snipit Library
Plugin 'honza/vim-snippets'

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



" Behavior settings
set nocompatible      " Vim behavior, not Vi.
set encoding=utf-8   " Use UTF-8 encoding
set nobackup         " Don't backup
set nowritebackup    " Write file in place
set noswapfile       " Don't use swap files (.swp)
set autoread         " Autoreload buffers
set autowrite        " Automatically save changes before switching buffers
set shell=$SHELL     " Default shell is ZSH
set showcmd          " Display incomplete commands
set visualbell       " Use visual bell instead of audible bell
set backspace=2      " Backspace works like other apps
set timeoutlen=500  " Timeout for key combos
set mouse=a          " Use mouse

" Tabs and spaces
set tabstop=2         " Tabs are 2 spaces
set shiftwidth=2      " 2 Spaces for << && >>
set softtabstop=2     " Tabs are 2 spaces for editing operations
set expandtab         " Always use spaces instead of tabs
set smartindent       " Auto indent
set nowrap            " Don't wrap lines
map <F7> mzgg=G`z     " F7 to format file

" Better Split Navigation
nnoremap <C-J> <C-W><C-J>
nnoremap <C-K> <C-W><C-K>
nnoremap <C-L> <C-W><C-L>
nnoremap <C-H> <C-W><C-H>

" Open splits to the right and below
set splitright
set splitbelow

" Code Completion
set complete=.,b,u,]
set wildmode=longest,list:longest
set completeopt=menu,menuone,preview
au FileType ruby,eruby setl ofu=rubycomplete#Complete
au FileType html,xhtml setl ofu=htmlcomplete#CompleteTags
au FileType css setl ofu=csscomplete#CompleteCSS

" Display settings
set number            " Show current line number
set relativenumber    " Show other line numbers as relative
set ruler             " Show curser position
set cursorline        " Highlight current cursor line
syntax on             " Syntax Highlighting
set background=dark   " Dark background style
colorscheme badwolf   " Color Scheme

" JSON Don't hide quotes
let g:vim_json_syntax_conceal = 0

" JSX in .js files
let g:jsx_ext_required = 0

" highlight the 80th column
if exists('+colorcolumn')
  let &colorcolumn="80"
  highlight ColorColumn ctermbg=236
endif

" Airline
set laststatus=2              " Always show status line
let g:airline_theme='wombat'  " Airline theme

" Git Gutter
let g:gitgutter_eager = 1     " Notice changes when switching buffer/tab/focus
let g:gitgutter_realtime = 1  " Notice changes after typing has stopped
set updatetime=250            " Faster update time for faster feedback

" NERDTree
let NERDTreeShowHidden=1                          " Show hidden files
map <Leader>n :NERDTreeToggle<CR>                 " Toggle NERDTree
map <Leader>m :NERDTreeFind<CR>                   " Toggle NERDTree

" Syntastic Syntax Highlighting
let g:syntastic_always_populate_loc_list = 1
let g:syntastic_auto_loc_list = 1
let g:syntastic_check_on_open = 1
let g:syntastic_check_on_wq = 0

" Searching
set ignorecase     " Case insensitive search
set smartcase      " Smarter Case insensitive search

" ctrlp find dotfiles
let g:ctrlp_show_hidden = 1

" Silver Searcher
let g:ag_working_path_mode="r"    " Search from project root
" use * to search current word in normal mode
nmap * <Plug>AgActionWord
" use * to search selected text in visual mode
vmap * <Plug>AgActionVisual
map <C-a> :noh<CR>

" RSpec.vim mappings
map <Leader>rc :call RunCurrentSpecFile()<CR>
map <Leader>rn :call RunNearestSpec()<CR>
map <Leader>rl :call RunLastSpec()<CR>
map <Leader>ra :call RunAllSpecs()<CR>

" make YCM compatible with UltiSnips (using supertab)
let g:ycm_key_list_select_completion = ['<C-n>', '<Down>']
let g:ycm_key_list_previous_completion = ['<C-p>', '<Up>']
let g:SuperTabDefaultCompletionType = '<C-n>'

" better key bindings for UltiSnipsExpandTrigger
let g:UltiSnipsExpandTrigger = "<tab>"
let g:UltiSnipsJumpForwardTrigger = "<tab>"
let g:UltiSnipsJumpBackwardTrigger = "<s-tab>"
