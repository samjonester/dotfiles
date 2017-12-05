eval $(/usr/libexec/path_helper -s)
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
alias v=vim
alias e="emacsclient -nw -c"

# Inline alias for grep.
# ls G foo    ==>   ls | grep foo
alias -g G='| grep '


# Other aliases
alias fixcam='sudo killall VDCAssistant'
alias fixwifi='sudo ifconfig en0 down && sudo ifconfig en0 up'
# alias npm=yarn
alias n=npm
alias nr='npm run'
alias nt='npm test'
alias ni='npm install'
alias tab='open . -a iTerm'
alias g=hub



#
# Development Tools
#

# Homebrew completions
fpath=(/usr/local/share/zsh-completions $fpath)


# Add stack executables to PATH
export PATH="$HOME/.local/bin:$PATH"

# added by travis gem
[ -f /Users/samjones/.travis/travis.sh ] && source /Users/samjones/.travis/travis.sh

# JENV.be
# export PATH="$HOME/.jenv/bin:$PATH"
# eval "$(jenv init -)"

# go version manager
#eval "$(goenv init -)"

# node version manager
eval "$(nodenv init -)"
export PATH="$HOME/.nodenv/shims:$PATH"

# ruby version manager
eval "$(rbenv init -)"

# elixir version manager
# eval "$(exenv init -)"

# git magic
eval "$(hub alias -s)"






# Make directory then cd into it
mcd() {
    mkdir -p $1
    cd $1
}



# TMATE Functions

TMATE_PAIR_NAME="$(whoami)-pair"
TMATE_SOCKET_LOCATION="/tmp/tmate-pair.sock"
TMATE_TMUX_SESSION="/tmp/tmate-tmux-session"

# Get current tmate connection url
tmate-url() {
  url="$(tmate -S $TMATE_SOCKET_LOCATION display -p '#{tmate_ssh}')"
  echo "$url" | tr -d '\n' | pbcopy
  echo "Copied tmate url for $TMATE_PAIR_NAME:"
  echo "$url"
}



# Start a new tmate pair session if one doesn't already exist
# If creating a new session, the first argument can be an existing TMUX session to connect to automatically
tmate-pair() {
  if [ ! -e "$TMATE_SOCKET_LOCATION" ]; then
    tmate -S "$TMATE_SOCKET_LOCATION" -f "$HOME/.tmate.conf" new-session -d -s "$TMATE_PAIR_NAME"

    while [ -z "$url" ]; do
      url="$(tmate -S $TMATE_SOCKET_LOCATION display -p '#{tmate_ssh}')"
    done
    tmate-url
    sleep 1

    if [ -n "$1" ]; then
      echo $1 > $TMATE_TMUX_SESSION
      tmate -S "$TMATE_SOCKET_LOCATION" send -t "$TMATE_PAIR_NAME" "TMUX='' tmux attach-session -t $1" ENTER
    fi
  fi
  tmate -S "$TMATE_SOCKET_LOCATION" attach-session -t "$TMATE_PAIR_NAME"
}



# Close the pair because security
tmate-unpair() {
  if [ -e "$TMATE_SOCKET_LOCATION" ]; then
    if [ -e "$TMATE_SOCKET_LOCATION" ]; then
      tmux detach -s $(cat $TMATE_TMUX_SESSION)
      rm -f $TMATE_TMUX_SESSION
    fi

    tmate -S "$TMATE_SOCKET_LOCATION" kill-session -t "$TMATE_PAIR_NAME" || echo 'Already detached'
    echo "Killed session $TMATE_PAIR_NAME"
  else
    echo "Session already killed"
  fi
}






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

[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh





# Cleanup Docker
docker-cleanup() {
  docker rm -f $(docker ps -aq)
  docker rmi -f $(docker images -q)
  docker volume rm $(docker volume ls -q)
}
