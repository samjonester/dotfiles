USER=$(whoami)
ZSH=/Users/$USER/.oh-my-zsh
ZSH_THEME="avit"

plugins=(zsh-syntax-highlighting rsync brew git gitignore docker docker-compose mvn gem bundler rails)

source $ZSH/oh-my-zsh.sh

# Show [$USER] [$COMMAND] on right
# RPROMPT="%{$fg_bold[red]%}[$USER]%{$reset_color%}  %{$fg_bold[green]%}[%!]%{$reset_color%}"
RPROMPT=""

source ~/.myzshrc
