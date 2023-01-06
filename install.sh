#!/usr/bin/env zsh

# Runs on setup of a new spin environment.
# Create common color functions.
autoload -U colors
colors

# Create an unversioned script for scripts that are specific to this local environment
# and that you don't want to follow you across environments.
touch ~/extra.zsh

DOTFILES_DIRECTORY_NAME=$([ $SPIN ] && echo "shopify-dotfiles" || echo "dotfiles")
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
fi

# Symlink core configs

# Link in the custom gitconfig.
ln -vsfn ~/$DOTFILES_DIRECTORY_NAME/core/configs/.gitconfig ~/.gitconfig
ln -vsfn ~/$DOTFILES_DIRECTORY_NAME/core/configs/.gitignore_global ~/.gitignore_global

# Symlink this repo's .zshrc to ~/.zshrc. Using a symlink ensures that when the repo is
# updated, the terminal will pick up the new version on reload without having to run
# install again. This will overwrite any existing .zshrc.
ln -vsfn ~/$DOTFILES_DIRECTORY_NAME/.zshrc ~/.zshrc

source ~/$DOTFILES_DIRECTORY_NAME/personal/install.sh
