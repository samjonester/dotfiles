# Define any custom environment scripts here.
# This file is loaded after everything else, but before Antigen is applied and ~/extra.zsh sourced.
# Put anything here that you want to exist on all your environment, and to have the highest priority
# over any other customization.

# Terminal tooling aliases
alias c=clear
alias v=nvim
alias g=git
alias n=npm
alias r=ranger

alias eza='eza --color=always --long --git --no-filesize --icons=always --no-time --no-user'
alias ls='eza'
alias tree='eza --tree --color=always'
alias t2='eza --tree --color=always --level=2'

# FZF Setup
source <(fzf --zsh)
source ~/src/github.com/junegunn/fzf-git.sh/fzf-git.sh
export FZF_DEFAULT_COMMAND="fd --hidden --strip-cwd-prefix --exclude .git"
export FZF_CTRL_T_COMMAND="$FZF_DEFAULT_COMMAND"
export FZF_CTRL_T_OPTS="--preview 'bat -n --color=always --line-range :500 {}'"
export FZF_ALT_C_COMMAND="fd --type=d --hidden --strip-cwd-prefix --exclude .git"
export FZF_ALT_C_OPTS="--preview 'eza --tree --level=2 --color=always {} | head -500'"

local color00='#32302f'
local color01='#3c3836'
local color02='#504945'
local color03='#665c54'
local color04='#bdae93'
local color05='#d5c4a1'
local color06='#ebdbb2'
local color07='#fbf1c7'
local color08='#fb4934'
local color09='#fe8019'
local color0A='#fabd2f'
local color0B='#b8bb26'
local color0C='#8ec07c'
local color0D='#83a598'
local color0E='#d3869b'
local color0F='#d65d0e'

export FZF_DEFAULT_OPTS="$FZF_DEFAULT_OPTS"\
" --color=bg+:$color01,bg:$color00,spinner:$color0C,hl:$color0D"\
" --color=fg:$color04,header:$color0D,info:$color0A,pointer:$color0C"\
" --color=marker:$color0C,fg+:$color06,prompt:$color0A,hl+:$color0D"

_fzf_compgen_path() {
  fd --hidden --exclude .git . "$1"
}

_fzf_compgen_dir() {
  fd --type=d --hidden --exclude .git . "$1"
}

# Bat setup
export BAT_THEME=gruvbox-dark
alias bat='bat --color=always'
alias cat='bat'

eval "$(zoxide init zsh)"

# Utility aliases 
alias fixcam='sudo killall VDCAssistant'
alias fixwifi='sudo ifconfig en0 down && sudo ifconfig en0 up'

# Utility functions
mcd() {
    mkdir -p $1
    cd $1
}

ps-kill() {
  ps aux | grep "$1" | grep -v grep | awk '{ print $2 }' | xargs kill -9
}

# Examples of call:
# git-clone-bare-for-worktrees git@github.com:name/repo.git
# => Clones to a /repo directory
#
# git-clone-bare-for-worktrees git@github.com:name/repo.git my-repo
# => Clones to a /my-repo directory
bare-clone() {
  url=$1
  basename=${url##*/}
  name=${2:-${basename%.*}}

  mkdir $name
  cd "$name"

  # Moves all the administrative git files (a.k.a $GIT_DIR) under .bare directory.
  #
  # Plan is to create worktrees as siblings of this directory.
  # Example targeted structure:
  # .bare
  # main
  # new-awesome-feature
  # hotfix-bug-12
  # ...
  git clone --bare "$url" .bare
  echo "gitdir: ./.bare" > .git

  # Explicitly sets the remote origin fetch so we can fetch remote branches
  git config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"

  # Gets all branches from origin
  git fetch origin
}
