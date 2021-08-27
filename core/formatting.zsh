##
# Color variables and functions to be used throughout zsh.
# There are often-used symbols at the bottom.

## Color variables

# Formatting
RESET="$reset_color"
BOLD=""
DIM=$(tput dim)
STANDOUT=""
UNDERLINE=""
BLINK=$(tput blink)
REVERSE=""
HIDDEN="\e[8m"

# Foreground
BLACK="$fg[black]"
RED="$fg[red]"
GREEN="$fg[green]"
YELLOW="$fg[yellow]"
BLUE="$fg[blue]"
PURPLE="$fg[purple]"
CYAN="$fg[cyan]"
WHITE="$fg[white]"

# Background
BG_BLACK=$(tput setab 0)
BG_RED=$(tput setab 1)
BG_GREEN=$(tput setab 2)
BG_YELLOW=$(tput setab 3)
BG_BLUE=$(tput setab 4)
BG_PURPLE=$(tput setab 5)
BG_CYAN=$(tput setab 6)
BG_WHITE=$(tput setab 7)

# Combinations
BBLUE="${BOLD}${BLUE}"
BCYAN="${BOLD}${CYAN}"

# https://linuxtidbits.wordpress.com/2008/08/11/output-color-on-bash-scripts/
listcolors()
{
	spectrum_ls
}

##
# Formatting symbols

# Fancy up output.
SKULL_CROSSBONES=$'\342\230\240'
RADIOACTIVE=$'\226\152\162'
BIOHAZARD=$'\226\152\163'

SWIRL="->"
BOLT="+"
if [[ $OS == 'osx' ]]; then
	SWIRL="🌀 "
	BOLT="⚡️"
fi
