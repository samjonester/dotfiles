# Define important environment variables

# Detect the current OS
# 'darwin' = MacOS
# 'linus'  = linux
export ZSH_HOST_OS=$(uname | awk '{print tolower($0)}')

# Make sure we're saving our history to a file
export HISTFILE=~/.zsh_history
export HISTSIZE=10000
export SAVEHIST=1000
touch $HISTFILE