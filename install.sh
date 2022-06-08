#!/usr/bin/env zsh

# Runs on setup of a new spin environment.
# Create common color functions.
autoload -U colors
colors

# Create an unversioned script for scripts that are specific to this local environment
# and that you don't want to follow you across environments.
touch ~/extra.zsh

ZSH_HOST_OS=$(uname | awk '{print tolower($0)}')

case $ZSH_HOST_OS in
  darwin*)

  BREW_EXECUTABLE=/opt/homebrew/bin/brew

  $BREW_EXECUTABLE shellenv > $HOME/.dotfile_brew_setup
  $BREW_EXECUTABLE install coreutils
;;
esac

# Install the antigen plugin/theme manager if it's not already installed.
if [[ ! -d $HOME/antigen ]]; then
	echo -e "Antigen not found, installing..."
	cd $HOME
	git clone https://github.com/zsh-users/antigen.git
	cd -
fi

if [ $SPIN ]; then
  # Install Ripgrep for better code searching: `rg <string>` to search. Obeys .gitignore
  sudo apt-get install -y ripgrep

  # Set system generated .gitconfig to .gitconfig.local. We'll pull it in later as part
  # of our custom gitconfig. The generated gitconfig already has the right user and email,
  # since Spin knows that from login.
  mv -n ~/.gitconfig ~/.gitconfig.local
fi

# Symlink core configs

# Link in the custom gitconfig. This has to happen after we rename to .gitconfig.local, otherwise we clobber the
# spin generated user config.
ln -vsfn ~/dotfiles/core/configs/.gitconfig ~/.gitconfig
ln -vsfn ~/dotfiles/core/configs/.gitignore_global ~/.gitignore_global

# Symlink this repo's .zshrc to ~/.zshrc. Using a symlink ensures that when the repo is
# updated, the terminal will pick up the new version on reload without having to run
# install again. This will overwrite any existing .zshrc.
ln -vsfn ~/dotfiles/.zshrc ~/.zshrc

source ~/dotfiles/personal/install.sh