# This script is run every time you log in. It's the entrypoint for all shell environment config.
# Don't modify this file directly, or you'll remove your ability to update against new versions of
# the dotfiles-starter-template

# Include the default Spin zshrc
if [ $SPIN ]; then
  source /etc/zsh/zshrc.default.inc.zsh
fi

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