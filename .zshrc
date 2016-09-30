USER=$(whoami)
ZSH=/Users/$USER/.oh-my-zsh
ZSH_THEME="avit"

plugins=(command-not-found zsh-syntax-highlighting emoji rsync brew tmux git gitignore git-extras github docker docker-compose mvn gradle ruby rvm gem bundler rake rails node npm nvm grunt)

source $ZSH/oh-my-zsh.sh

# Show [$USER] [$COMMAND] on right
RPROMPT="%{$fg_bold[red]%}[$USER]%{$reset_color%}  %{$fg_bold[green]%}[%!]%{$reset_color%}"

# in the history command output.
# The optional three formats: "mm/dd/yyyy"|"dd.mm.yyyy"|"yyyy-mm-dd"
HIST_STAMPS="mm/dd/yyyy"

# Terminal Settings
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8
[[ "$TERM" == "xterm" ]] && export TERM=xterm-256color

# When trimming history, lose oldest duplicates first
setopt hist_expire_dups_first
# Remove subsequent duplicate entries in history
setopt histignoredups
# When searching history don't display results already cycled through twice
setopt hist_find_no_dups
# Show completion item type when listing
setopt listtypes
# Remove annoying beep when autocompleting
setopt nolistbeep
# Auto expand eported named paths as named directories
setopt autonamedirs
# Search named dirs when expanding paths
setopt cdablevars
# Better glob expansions
setopt extendedglob
# Add comamnds as they are typed, don't wait until shell exit
setopt inc_append_history
# Allow completion from within a word/phrase
setopt complete_in_word
# When completing from the middle of a word, move the cursor to the end of the word
setopt always_to_end

# Enable Ctrl-x-e to edit command line
autoload -U edit-command-line
# Emacs style
zle -N edit-command-line
bindkey '^xe' edit-command-line
bindkey '^x^e' edit-command-line






# Inline alias for grep.
# ls G foo    ==>   ls | grep foo
alias -g G='| grep '

# cd by .. or ... or ... or mv file ..../.
alias '..'='cd ..'
alias -g ...='../..'
alias -g ....='../../..'
alias -g .....='../../../..'

# Use Neovim instead of vim
alias vim=nvim
export EDITOR='nvim'

# Local Environment Variables
[[ -s "/Users/sam/.localrc" ]] && source "/Users/sam/.localrc"




# Add stack executables to PATH
export PATH="$HOME/.local/bin:$PATH"

# added by travis gem
[ -f /Users/samjones/.travis/travis.sh ] && source /Users/samjones/.travis/travis.sh

# JENV.be
export PATH="$HOME/.jenv/bin:$PATH"
eval "$(jenv init -)"

# go version manager
[[ -s "/Users/sam/.gvm/scripts/gvm" ]] && source "/Users/sam/.gvm/scripts/gvm"

# node version manager
export NVM_DIR="/Users/sam/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"  # This loads nvm

# ruby version manager
export PATH="$PATH:$HOME/.rvm/bin" # Add RVM to PATH for scripting
[[ -s "$HOME/.rvm/scripts/rvm" ]] && . "$HOME/.rvm/scripts/rvm" 

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
