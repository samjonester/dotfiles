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
Plugin 'altercation/vim-colors-solarized'
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
" Better auto completion
Plugin 'Shougo/deoplete.nvim'
" UltiSnips
Plugin 'SirVer/ultisnips'
" Snipit Library
Plugin 'honza/vim-snippets'
" Rspec Snippets
Plugin 'Trevoke/ultisnips-rspec'
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
Plugin 'eagletmt/ghcmod-vim'
Plugin 'eagletmt/neco-ghc'
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
" Tabular
Plugin 'godlygeek/tabular'
" Vim Proc
Plugin 'Shougo/vimproc.vim'
" Open Close Parens & Brackets
Plugin 'jiangmiao/auto-pairs'
" Change project root
Plugin 'airblade/vim-rooter'

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
set nobackup         " Don't backup
set nowritebackup    " Write file in place
set noswapfile       " Don't use swap files (.swp)
set autoread         " Autoreload buffers
set autowrite        " Automatically save changes before switching buffers
set shell=zsh        " Same shell I normally use
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
nnoremap <bs> <C-W><C-H> " Fix <C-H> in neovim
nnoremap <C-H> <C-W><C-H>

" Neovim terminal stuff
tnoremap <ESC> <C-\><C-n>

" Open splits to the right and below
set splitright
set splitbelow

" Display settings
set number            " Show current line number
set ruler             " Show curser position
set cursorline        " Highlight current cursor line
set cuc cul"          " Highlight active column
syntax on             " Syntax Highlighting
set background=dark   " Dark background style
" colorscheme darth     " Color Scheme
set background=dark
colorscheme solarized
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
let g:airline_theme='solarized'  " Airline theme
let g:airline_powerline_fonts = 1

" Git Gutter
let g:gitgutter_eager = 4     " Notice changes when switching buffer/tab/focus
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
let g:rspec_command = "tabe | term rbenv exec bundle exec rspec {spec}" " Fix rspec to run in neovim tab
map <Leader>rc :call RunCurrentSpecFile()<CR>
map <Leader>rn :call RunNearestSpec()<CR>
map <Leader>rl :call RunLastSpec()<CR>
map <Leader>ra :call RunAllSpecs()<CR>

" Auto Completion
let g:deoplete#enable_at_startup = 1
let g:deoplete#auto_completion_start_length = 2
let g:deoplete#enable_smart_case = 1
set completeopt=menu,preview,noinsert

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
au BufWritePost *.rb,*.js,*.hs silent! !eval 'ctags -R -o newtags; mv newtags tags' &
map <C-\> :tab split<CR>:exec("tag ".expand("<cword>"))<CR>
map <A-\> :split <CR>:exec("tag ".expand("<cword>"))<CR>
map <A-]> :vsp <CR>:exec("tag ".expand("<cword>"))<CR>

" Haskell setup
" let g:necoghc_debug = 1  " Enable to debug plugin
let g:haskellmode_completion_ghc = 1
autocmd FileType haskell setlocal omnifunc=necoghc#omnifunc
let g:necoghc_enable_detailed_browse = 1
let g:haskell_tabular = 1
vmap a= :Tabularize /=<CR>
vmap a; :Tabularize /::<CR>
vmap a- :Tabularize /-><CR>

" vim rooter project
let g:rooter_change_directory_for_non_project_files = 'current'

" NPM Test
map <Leader>ni :vsp <Bar>terminal npm install <CR>
map <Leader>nt :vsp <Bar> terminal  npm test <CR>

" Find Replace
nnoremap <Leader>s :%s/\<<C-r><C-w>\>/
