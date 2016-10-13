#
# Executes commands at login pre-zshrc.
#


# ZSH Options
# When listing files that are possible completions, show the type of each file with a trailing identifying mark.
setopt listtypes
# Remove annoying beep when autocompleting
setopt nolistbeep



# in the history command output.
# The optional three formats: "mm/dd/yyyy"|"dd.mm.yyyy"|"yyyy-mm-dd"
HIST_STAMPS="mm/dd/yyyy"


# Terminal Settings
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8
[[ "$TERM" == "xterm" ]] && export TERM=xterm-256color


# Editors and Browsers
export EDITOR='nano'
export VISUAL='nvim'
export PAGER='less'
export BROWSER='open'


#
# Paths
#

# Ensure path arrays do not contain duplicates.
typeset -gU cdpath fpath mailpath path

# Set the the list of directories that cd searches.
# cdpath=(
#   $cdpath
# )

# Set the list of directories that Zsh searches for programs.
path=(
  /usr/local/{bin,sbin}
  $path
)

#
# Temporary Files
#

if [[ ! -d "$TMPDIR" ]]; then
  export TMPDIR="/tmp/$LOGNAME"
  mkdir -p -m 700 "$TMPDIR"
fi

TMPPREFIX="${TMPDIR%/}/zsh"
