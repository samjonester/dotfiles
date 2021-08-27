# Set up a bunch of environment configs, depending on whether this is OSX or Linux

export ZSH_HOST_OS=$(uname | awk '{print tolower($0)}')

case $ZSH_HOST_OS in
	darwin*)

	#Environment variables

	# Assumes that coreutils and other GNU tools have replaced OSX'
	export PATH="/usr/local/opt/gnu-tar/libexec/gnubin:$PATH"
	export PATH="$(brew --prefix coreutils)/libexec/gnubin:$PATH"
	export MANPATH="$(brew --prefix coreutils)/libexec/gnuman:$MANPATH"
	alias ls='gls --color=auto'

	# Aliases
	alias stfu="osascript -e 'set volume output muted true'"
	alias flushdns="dscacheutil -flushcache"

	# Faster keyboard repeat rate. The defaults available are so slow and it takes ages to delete a lot of text.
	defaults write NSGlobalDomain KeyRepeat -int 1
	defaults write NSGlobalDomain InitialKeyRepeat -int 12
	defaults write com.apple.finder AppleShowAllFiles YES
;;
esac