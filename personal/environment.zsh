# Define custom environment variables.
# This will overwrite any environment variables defined by `core/environment.zsh`.

# Terminal Settings
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8
[[ "$TERM" == "xterm" ]] && export TERM=xterm-256color


# Editors and Browsers
export EDITOR='nano'
export VISUAL='vim'
export PAGER='less'
export BROWSER='open'