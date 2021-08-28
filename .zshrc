# This script is run every time you log in. It's the entrypoint for all shell environment config.
# Don't modify this file directly, or you'll remove your ability to update against new versions of
# the dotfiles-starter-template

# Include the default Spin zshrc
# This file has a number of useful functions for detecting the status of the Spin environment.
# We can still overwrite the terminal display later on, if we want.
if [ $SPIN ]; then
  source /etc/zsh/zshrc.default.inc.zsh
fi

# Set up custom environment variables
source ~/dotfiles/core/environment.zsh

# Load color helper variable definitions
source ~/dotfiles/core/formatting.zsh

# Load configs for MacOS. Does nothing if not on MacOS
if [ "$ZSH_HOST_OS" = "darwin" ]; then
  source ~/dotfiles/core/macos.zsh
  if [ -e ~/dotfiles/personal/macos.zsh ]; then
    source ~/dotfiles/personal/macos.zsh
  fi
fi

# Load zsh plugins via Antigen
source ~/dotfiles/core/default_bundles.zsh
if [ -e ~/dotfiles/personal/antigen_bundles.zsh ]; then
  source ~/dotfiles/personal/antigen_bundles.zsh
fi

# Load custom dircolors, if present
if [ -e ~/dotfiles/personal/dircolors ]; then
  eval $(dircolors ~/dotfiles/personal/dircolors)
fi

# Load personalized configs for Spin environments
if [ $SPIN ]; then
  source ~/dotfiles/personal/spin.zsh
fi

# Loading autocompletions is time consuming. It's faster to do it all once all configuration
# is ready. That way, if the user wants to modify the antigen bundles included by default,
# they won't incur an additional time cost from another call to apply.
antigen apply

# Load changes specific to this local environment.
if [ -e ~/extra.zsh ]; then
  source ~/extra.zsh
fi