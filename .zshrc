USER=$(whoami)
# Path to your oh-my-zsh configuration.
ZSH=/Users/$USER/.oh-my-zsh

# Set name of the theme to load.
# Look in ~/.oh-my-zsh/themes/
# Optionally, if you set this to "random", it'll load a random theme each
# time that oh-my-zsh is loaded.
ZSH_THEME="robbyrussell"

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
plugins=(git gitignore autojump command-not-found zsh-syntax-highlighting mvn macports osx textmate wd git-extras)

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

STR='[%D{%L:%M:%S %p}]'
RPROMPT="%{$fg_bold[red]%}[$USER]%{$reset_color%}  %{$fg_bold[yellow]%}$STR%{$reset_color%} %{$fg_bold[green]%}[%!]%{$reset_color%}"

TMOUT=1

TRAPALRM() {
    zle reset-prompt
}

alias up_sources='rsync -Pre ssh go-darth:/opt/local/var/go-clinical/annotations /opt/local/var/go-clinical'

# Add devtools for genomoncology
PATH=$PATH:$HOME/code/clinical_project/devtools/bin

dtree() {
  cd ~/repos/go-clinical
  mvn dependency:tree
  cd ~/repos/go-gwt-ext
  mvn dependency:tree
  cd ~/repos/go-spring
  mvn dependency:tree
  cd ~/repos/lis-app
  mvn dependency:tree
  cd ~/repos/clinical-app
  mvn dependency:tree
  cd ~/repos/clinical-refapp
  mvn dependency:tree
  cd ~/repos/go-admin
  mvn dependency:tree
  cd ~/repos/go-esb
  mvn dependency:tree
}

[[ "$TERM" == "xterm" ]] && export TERM=xterm-256color

export PATH="$PATH:$HOME/.rvm/bin" # Add RVM to PATH for scripting

# added by travis gem
[ -f /Users/samjones/.travis/travis.sh ] && source /Users/samjones/.travis/travis.sh


function setjdk() {
  if [ $# -ne 0 ]; then
   removeFromPath '/System/Library/Frameworks/JavaVM.framework/Home/bin'
   if [ -n "${JAVA_HOME+x}" ]; then
    removeFromPath $JAVA_HOME
   fi
   export JAVA_HOME=`/usr/libexec/java_home -v $@`
   export PATH=$JAVA_HOME/bin:$PATH
  fi
 }
 function removeFromPath() {
  export PATH=$(echo $PATH | sed -E -e "s;:$1;;" -e "s;$1:?;;")
 }
setjdk 1.7

alias goclin='open /opt/local/var/go-clinical/ -a MacVim'
