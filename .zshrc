#
# Loads & Customizes Prezto
#

# Source Prezto.
if [[ -s "${ZDOTDIR:-$HOME}/.zprezto/init.zsh" ]]; then
  source "${ZDOTDIR:-$HOME}/.zprezto/init.zsh"
fi


# Customize to your needs...


#
# Aliases
#


# Editor aliases
alias vim=nvim
alias v=vim
alias e="emacsclient -nw -c"

# Inline alias for grep.
# ls G foo    ==>   ls | grep foo
alias -g G='| grep '


# Other aliases
alias fixcam='sudo killall VDCAssistant'
alias n=npm



#
# Development Tools
#


# Add stack executables to PATH
export PATH="$HOME/.local/bin:$PATH"

# added by travis gem
[ -f /Users/samjones/.travis/travis.sh ] && source /Users/samjones/.travis/travis.sh

# JENV.be
# export PATH="$HOME/.jenv/bin:$PATH"
# eval "$(jenv init -)"

# go version manager
[[ -s "/Users/sam/.gvm/scripts/gvm" ]] && source "/Users/sam/.gvm/scripts/gvm"

# node version manager
export PATH="$HOME/.nodenv/bin:$PATH"
eval "$(nodenv init -)"

# ruby version manager
export PATH="$HOME/.rbenv/bin:$PATH"
eval "$(rbenv init -)"

# git magic
eval "$(hub alias -s)"






# Make directory then cd into it
mcd() {
    mkdir -p $1
    cd $1
}



# Tmux Functions

# t foobar
# opens / creates a tmux session named foobar and navigates to ~/code
t() {
  local session_name
  session_name="$(pwd | rev | cut -d '/' -f1 | rev)"

  if ! $(tmux has-session -t "$session_name" 2> /dev/null); then
    tmux new-session -d -s "$session_name"
  fi

  tmux attach-session -t "$session_name"
  export TMUX_SESSION="$session_name"
}

# td
# Detach from current tmux
td() {
  if [ ! -z "$TMUX" ]; then
    tmux detach
  fi
}

# tk
# Detach and kill current tmux session
# tk foobar
# Kill tmux session foobar
tk() {
  if [ -z "$TMUX" ]; then
    tmux kill-session -t $1
  else
    tmux detach
    tmux kill-session -t $(tmux display-message -p '#S')
  fi
}

# tl
# List tmux sessions
alias tl="tmux ls 2> /dev/null"






# Pair Programming
PAIR_IP=107.170.115.65
pair() {
  ssh -f -N -R 1337:127.0.0.1:22 root@$PAIR_IP
  echo
  echo
  echo "Pair session started"
  echo
  echo "To connect, execute the following command (copied to clipboard):"
  echo "ssh -p 1337 pair@$PAIR_IP"
  echo "ssh -p 1337 pair@$PAIR_IP" | pbcopy
  sleep 5
  wemux start
}
