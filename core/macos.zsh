# Set up OSX specific configs

case $ZSH_HOST_OS in
	darwin*)

	#Environment variables
  source ~/.dotfile_brew_setup

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

  # Show hidden files in finder. I want to see everything.
	defaults write com.apple.finder AppleShowAllFiles YES
;;
esac