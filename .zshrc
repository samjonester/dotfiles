USER=$(whoami)
# Path to your oh-my-zsh configuration.
ZSH=/Users/$USER/.oh-my-zsh

# Set name of the theme to load.
# Look in ~/.oh-my-zsh/themes/
# Optionally, if you set this to "random", it'll load a random theme each
# time that oh-my-zsh is loaded.
ZSH_THEME="avit"

# Example aliases
# alias zshconfig="mate ~/.zshrc"
# alias ohmyzsh="mate ~/.oh-my-zsh"

# Set this to use case-sensitive completion
# CASE_SENSITIVE="true"

# Uncomment this to disable bi-weekly auto-update checks
# DISABLE_AUTO_UPDATE="true"

# Uncomment to change how often to auto-update? (in days)
# export UPDATE_ZSH_DAYS=13

# Uncomment following line if you want to disable colors in ls
# DISABLE_LS_COLORS="true"

# Uncomment following line if you want to disable autosetting terminal title.
# DISABLE_AUTO_TITLE="true"

# Uncomment following line if you want to disable command autocorrection
# DISABLE_CORRECTION="true"

# Uncomment following line if you want red dots to be displayed while waiting for completion
# COMPLETION_WAITING_DOTS="true"

# Uncomment following line if you want to disable marking untracked files under
# VCS as dirty. This makes repository status check for large repositories much,
# much faster.
# DISABLE_UNTRACKED_FILES_DIRTY="true"

# Uncomment following line if you want to the command execution time stamp shown
# in the history command output.
# The optional three formats: "mm/dd/yyyy"|"dd.mm.yyyy"|"yyyy-mm-dd"
# HIST_STAMPS="mm/dd/yyyy"

# Which plugins would you like to load? (plugins can be found in ~/.oh-my-zsh/plugins/*)
# Custom plugins may be added to ~/.oh-my-zsh/custom/plugins/
# Example format: plugins=(rails git textmate ruby lighthouse)
plugins=(git gitignore command-not-found zsh-syntax-highlighting ruby rails git-extras npm brew tmux)

source $ZSH/oh-my-zsh.sh

# User configuration

#export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/usr/local/git/bin"
# export MANPATH="/usr/local/man:$MANPATH"

# # Preferred editor for local and remote sessions
# if [[ -n $SSH_CONNECTION ]]; then
#   export EDITOR='vim'
# else
#   export EDITOR='mvim'
# fi

# Compilation flags
# export ARCHFLAGS="-arch x86_64"

# ssh
# export SSH_KEY_PATH="~/.ssh/dsa_id"

# Show [$USER] [$COMMAND] on right
RPROMPT="%{$fg_bold[red]%}[$USER]%{$reset_color%}  %{$fg_bold[green]%}[%!]%{$reset_color%}"

# Make colors work
[[ "$TERM" == "xterm" ]] && export TERM=xterm-256color


# added by travis gem
[ -f /Users/samjones/.travis/travis.sh ] && source /Users/samjones/.travis/travis.sh

# JENV.be
export PATH="$HOME/.jenv/bin:$PATH"
eval "$(jenv init -)"

# kiex elixir version manager
[[ -s "$HOME/.kiex/scripts/kiex" ]] && source "$HOME/.kiex/scripts/kiex"

# nvm node version manager
export NVM_DIR="/Users/sam/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"  # This loads nvm

# gvm go version manager
[[ -s "/Users/sam/.gvm/scripts/gvm" ]] && source "/Users/sam/.gvm/scripts/gvm"

# rvm ruby version manager
export PATH="$PATH:$HOME/.rvm/bin" # Add RVM to PATH for scripting
[[ -s "$HOME/.rvm/scripts/rvm" ]] && . "$HOME/.rvm/scripts/rvm"

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

jsvim() {
  cp ~/code/dotfiles/.eslintrc .
  touch .tern-project
}

alias vim=nvim

mcd() {
  mkdir -p $1
  cd $1
}
