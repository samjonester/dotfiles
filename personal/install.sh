# Custom actions to take on initial install of dotfiles.
# This runs after default install actions, so you can overwrite changes it makes if you want.

ZSH_HOST_OS=$(uname | awk '{print tolower($0)}')

case $ZSH_HOST_OS in
darwin*)
  $BREW_EXECUTABLE install ripgrep
  $BREW_EXECUTABLE install fzf
  $BREW_EXECUTABLE install fzy
  $BREW_EXECUTABLE install bat
  $BREW_EXECUTABLE install eza
  $BREW_EXECUTABLE install tig
  $BREW_EXECUTABLE install ranger
  $BREW_EXECUTABLE install asdf
  $BREW_EXECUTABLE install lazygit
  asdf plugin add ruby
  asdf plugin add erlang
  asdf plugin add elixir
  asdf plugin add node
  asdf plugin add terraform

  $BREW_EXECUTABLE install --cask font-jetbrains-mono-nerd-font

  $BREW_EXECUTABLE install kitty
  ln -vsfn ~/$DOTFILES_DIRECTORY_NAME/personal/kitty ~/.config/

  $BREW_EXECUTABLE install neovim
  ln -vsfn ~/$DOTFILES_DIRECTORY_NAME/personal/nvim ~/.config/

  $BREW_EXECUTABLE install neovim
  ;;
esac

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install VSCode Extensions & configs
cat ~/$DOTFILES_DIRECTORY_NAME/personal/code-extensions.list | xargs -L 1 code --force --install-extension
ln -vsfn ~/$DOTFILES_DIRECTORY_NAME/personal/code-user-settings.json ~/Library/Application\ Support/Code/User/settings.json
