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

# Shopify Dev tooling setup
[[ -f /opt/dev/sh/chruby/chruby.sh ]] && { type chruby >/dev/null 2>&1 || chruby () { source /opt/dev/sh/chruby/chruby.sh; chruby "$@"; } }
[[ -x /opt/homebrew/bin/brew ]] && eval $(/opt/homebrew/bin/brew shellenv)
[ -f /opt/dev/dev.sh ] && source /opt/dev/dev.sh

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
