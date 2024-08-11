# Define any custom environment scripts here.
# This file is loaded after everything else, but before Antigen is applied and ~/extra.zsh sourced.
# Put anything here that you want to exist on all your environment, and to have the highest priority
# over any other customization.

alias v=nvim
alias g=git
alias n=npm
alias r=ranger

alias fixcam='sudo killall VDCAssistant'
alias fixwifi='sudo ifconfig en0 down && sudo ifconfig en0 up'

alias ls='eza --long --all --group --header --classify --git'

source <(fzf --zsh)
[[ -f /opt/dev/sh/chruby/chruby.sh ]] && { type chruby >/dev/null 2>&1 || chruby () { source /opt/dev/sh/chruby/chruby.sh; chruby "$@"; } }
[[ -x /opt/homebrew/bin/brew ]] && eval $(/opt/homebrew/bin/brew shellenv)
[ -f /opt/dev/dev.sh ] && source /opt/dev/dev.sh


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