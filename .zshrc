# This script is run every time you log in. It's the entrypoint for all shell environment config.
# Don't modify this file directly, or you'll remove your ability to update against new versions of
# the dotfiles-starter-template

export DOTFILES_DIRECTORY_NAME=$([ $SPIN ] && echo "shopify-dotfiles" || echo "dotfiles")
export DF_HOME=~/$DOTFILES_DIRECTORY_NAME
export DF_CORE=$DF_HOME/core
export DF_USER=$DF_HOME/personal

# Create common color functions.
autoload -U colors
colors

# Include the default Spin zshrc
# This file has a number of useful functions for detecting the status of the Spin environment.
# We can still overwrite the terminal display later on, if we want.
if [ $SPIN ]; then
  if [ -e /etc/zsh/zshrc.default.inc.zsh ]; then
    source /etc/zsh/zshrc.default.inc.zsh
  fi
fi

# Set up custom environment variables
source $DF_CORE/environment.zsh
source $DF_USER/environment.zsh

# Load color helper variable definitions
source $DF_CORE/formatting.zsh

# Load configs for MacOS. Does nothing if not on MacOS
if [ "$ZSH_HOST_OS" = "darwin" ]; then
  source $DF_CORE/macos.zsh
  if [ -e $DF_USER/macos.zsh ]; then
    source $DF_USER/macos.zsh
  fi
fi

# Load zsh plugins via Antigen
source $DF_CORE/default_bundles.zsh
source $DF_USER/antigen_bundles.zsh
antigen apply

source $DF_CORE/utils.zsh

# Load custom dircolors, if present
if [ -e $DF_USER/dircolors ]; then
  eval $(dircolors $DF_USER/dircolors)
fi

source $DF_CORE/filter_history.zsh

# Load personalized configs for Spin environments
source $DF_USER/spin.zsh

source $DF_USER/custom.zsh

# Load changes specific to this local environment.
source ~/extra.zsh
