# This script is run every time you log in. It's the entrypoint for all shell environment config.
# Don't modify this file directly, or you'll remove your ability to update against new versions of
# the dotfiles-starter-template

# Include the default Spin zshrc
# This file has a number of useful functions for detecting the status of the Spin environment.
# We can still overwrite the terminal display later on, if we want.
if [ $SPIN ]; then
  source /etc/zsh/zshrc.default.inc.zsh
fi

# Set up important environment variables
source ~/dotfiles/core/environment.zsh

# Load color helper variable definitions
source ~/dotfiles/core/formatting.zsh

# Load configs for MacOS. Does nothing if not on MacOS
source ~/dotfiles/core/osx.zsh

# Prepare default antigen plugins
source ~/dotfiles/core/default_bundles.zsh

# Load custom dircolors, if present
test -f ~/dotfiles/personal/dircolors && eval $(dircolors ~/dotfiles/personal/dircolors)

# Load your own custom scripts from ~/dotfiles/personal. 
# Everything in that directory with a .zsh extension will be sourced.
test -d ~/dotfiles/personal && antigen bundle ~/dotfiles/personal --no-local-clone

# Loading autocompletions is time consuming. It's faster to do it all once all configuration
# is ready. That way, if the user wants to modify the antigen bundles included by default,
# they won't incur an additional time cost from another call to apply.
antigen apply

# Load changes specific to this local environment.
test -f ~/extra.zsh && source ~/extra.zsh