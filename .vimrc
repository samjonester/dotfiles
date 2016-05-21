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
Plugin 'vim-airline/vim-airline-themes'
" json syntax highlighting
Plugin 'elzr/vim-json'
" Syntax error highlighting
Plugin 'benekastah/neomake'
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
Plugin 'ctrlpvim/ctrlp.vim'
Plugin 'fisadev/vim-ctrlp-cmdpalette'
" Silver searcher
Plugin 'rking/ag.vim'
" Silver search * search
Plugin 'Chun-Yang/vim-action-ag'
" Run rspecs
Plugin 'thoughtbot/vim-rspec'
" End blocks properly
Plugin 'tpope/vim-endwise'
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
" Better markdown
Plugin 'gabrielelana/vim-markdown'
" Javascript library syntax
Plugin 'othree/javascript-libraries-syntax.vim'
" Jasmine JavaScript Testing
Plugin 'claco/jasmine.vim'
" HTML 5 syntax
Plugin 'othree/html5-syntax.vim'
" Ember HBS Syntax Highlighting
Plugin 'joukevandermaas/vim-ember-hbs'
" Haskell
Plugin 'neovimhaskell/haskell-vim'
Plugin 'laurilehmijoki/haskellmode-vim'
" Repeat plugin actions
Plugin 'tpope/vim-repeat'
" RVM
Plugin 'tpope/vim-rvm'
" Bundler (bundle commands and gem tags)
Plugin 'tpope/vim-bundler'
" Easy motion for navigation
Plugin 'easymotion/vim-easymotion'
" Docs
Plugin 'rizzatti/dash.vim'
" ruby refactoring
Plugin 'ecomba/vim-ruby-refactoring'

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
if !has('nvim')
  set encoding=utf-8   " Use UTF-8 encoding
endif
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
if has('nvim')
  nnoremap <bs> <C-W><C-H>
else
  nnoremap <C-H> <C-W><C-H>
endif

" Neovim terminal stuff
if has('nvim')
  tnoremap <ESC> <C-\><C-n>
endif

" Open splits to the right and below
set splitright
set splitbelow

" Code Completion
" set complete=.,b,u,]
" set wildmode=longest,list:longest
" set completeopt=menu,menuone,preview
" au FileType ruby,eruby setl ofu=rubycomplete#Complete
" au FileType html,xhtml setl ofu=htmlcomplete#CompleteTags
" au FileType css setl ofu=csscomplete#CompleteCSS

" Display settings
set number            " Show current line number
set ruler             " Show curser position
set cursorline        " Highlight current cursor line
syntax on             " Syntax Highlighting
set background=dark   " Dark background style
colorscheme darth     " Color Scheme
set spell             " Turn on spell checking

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

" Neomake syntax checker
autocmd! BufWritePost * Neomake
autocmd! BufRead * Neomake
let g:neomake_echo_current_error=1
let g:neomake_open_list=1
let g:neomake_javascript_enabled_makers=['standard']
if filereadable(".eslintrc")
  let g:neomake_javascript_enabled_makers=['eslint']
endif
if filereadable(".jshint")
  let g:neomake_javascript_enabled_makers=['jshint']
endif
nmap <Leader>mc :lclose<CR>
nmap <Leader>mo :lopen<CR>
nmap <Leader>mn :lnext<CR>
nmap <Leader>mp :lprev<CR>


" Searching
set ignorecase     " Case insensitive search
set smartcase      " Smarter Case insensitive search

" ctrlp find dotfiles
let g:ctrlp_show_hidden = 1
let g:ctrlp_custom_ignore = 'node_modules\|DS_Store\|git'
map <M-Space> :CtrlPCmdPalette<CR>

" Silver Searcher
let g:ag_working_path_mode="r"    " Search from project root
" use * to search current word in normal mode
nmap K <Plug>AgActionWord
" use * to search selected text in visual mode
vmap K <Plug>AgActionVisual
map <C-a> :noh<CR>

" RSpec.vim mappings
if has('nvim')
  let g:rspec_command = "tabe | term rspec {spec}"
endif
map <Leader>rc :call RunCurrentSpecFile()<CR>
map <Leader>rn :call RunNearestSpec()<CR>
map <Leader>rl :call RunLastSpec()<CR>
map <Leader>ra :call RunAllSpecs()<CR>

let g:ycm_add_preview_to_completeopt=0
let g:ycm_confirm_extra_conf=0
set completeopt-=preview

" make YCM compatible with UltiSnips (using supertab)
let g:ycm_key_list_select_completion = ['<C-n>', '<Down>']
let g:ycm_key_list_previous_completion = ['<C-p>', '<Up>']
let g:SuperTabDefaultCompletionType = '<C-n>'

" better key bindings for UltiSnipsExpandTrigger
let g:UltiSnipsExpandTrigger = "<tab>"
let g:UltiSnipsJumpForwardTrigger="<c-j>"
let g:UltiSnipsJumpBackwardTrigger="<c-k>"

" MyTips help file
autocmd BufWrite mytips.txt             :helptags ~/.vim/doc/
autocmd BufRead  mytips.txt             set filetype=help
autocmd BufRead  mytips.txt             set noreadonly
autocmd BufRead  mytips.txt             set modifiable

" tags
au BufWritePost * silent! !eval 'ctags -R -o newtags; mv newtags tags' &

" Haskell setup
" use ghc functionality for haskell files
au Bufenter *.hs compiler ghc
" Configure browser for haskell_doc.vim
let g:haddock_browser = "open"
let g:haddock_browser_callformat = "%s %s"
