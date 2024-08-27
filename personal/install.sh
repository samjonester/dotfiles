# Custom actions to take on initial install of dotfiles.
# This runs after default install actions, so you can overwrite changes it makes if you want.

ZSH_HOST_OS=$(uname | awk '{print tolower($0)}')

case $ZSH_HOST_OS in
darwin*)
  # Terminal
  chsh -s $(which zsh)
  $BREW_EXECUTABLE install --cask font-jetbrains-mono-nerd-font
  $BREW_EXECUTABLE install kitty
  ln -vsfn ~/$DOTFILES_DIRECTORY_NAME/personal/kitty ~/.config/
  git clone --depth 1 https://github.com/dexpota/kitty-themes.git ~/.config/kitty/kitty-themes

  # Terminal Tooling
  $BREW_EXECUTABLE install bat
  $BREW_EXECUTABLE install eza
  $BREW_EXECUTABLE install ranger
  ln -vsfn ~/$DOTFILES_DIRECTORY_NAME/personal/ranger ~/.config/
  git clone https://github.com/alexanderjeurissen/ranger_devicons ~/.config/ranger/plugins/ranger_devicons
  $BREW_EXECUTABLE install zoxide

  # Git tooling
  $BREW_EXECUTABLE install tig
  $BREW_EXECUTABLE install lazygit
  $BREW_EXECUTABLE install delta
  $BREW_EXECUTABLE install gh
  gh auth login --web -h github.com
  gh extension install github/gh-copilot --force

  # Search
  $BREW_EXECUTABLE install fzf
  $BREW_EXECUTABLE install fzy
  $BREW_EXECUTABLE install fd
  $BREW_EXECUTABLE install ripgrep
  git clone https://github.com/junegunn/fzf-git.sh.git ~/src/github.com/junegunn/fzf-git.sh

  # ASDF Version Management
  $BREW_EXECUTABLE install asdf
  asdf plugin add ruby
  asdf install ruby latest
  asdf global ruby latest
  asdf plugin add node
  asdf install nodejs latest
  asdf global nodejs latest
  asdf plugin add erlang
  asdf plugin add elixir
  asdf plugin add terraform

  # Setup Neovim
  $BREW_EXECUTABLE install neovim
  ln -vsfn ~/$DOTFILES_DIRECTORY_NAME/personal/nvim ~/.config/

  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

  # Install VSCode Extensions & configs
  cat ~/$DOTFILES_DIRECTORY_NAME/personal/code-extensions.list | xargs -L 1 code --force --install-extension
  ln -vsfn ~/$DOTFILES_DIRECTORY_NAME/personal/code-user-settings.json ~/Library/Application\ Support/Code/User/settings.json

  ;;
linux*)
  HOST_OS_ID=$(awk -F= '$1=="ID" { print $2 ;}' /etc/os-release | tr -d '"')
  case $HOST_OS_ID in
  ubuntu)

    # Terminal
    chsh -s $(which zsh)

    # Terminal Tooling
    sudo apt-get install -y bat eza ranger zoxide
    ln -vsfn ~/$DOTFILES_DIRECTORY_NAME/personal/ranger ~/.config/
    git clone https://github.com/alexanderjeurissen/ranger_devicons ~/.config/ranger/plugins/ranger_devicons

    # Git tooling
    sudo apt-get install -y tig lazygit delta

    # Search
    sudo apt-get install -y fzf fzy fd ripgrep
    git clone https://github.com/junegunn/fzf-git.sh.git ~/src/github.com/junegunn/fzf-git.sh

    # Setup Neovim
    sudo apt-get install neovim
    ln -vsfn ~/$DOTFILES_DIRECTORY_NAME/personal/nvim ~/.config/

    # Install VS Code Extensions
    # cat ~/$DOTFILES_DIRECTORY_NAME/personal/code-extensions.list | xargs -L 1 code --force --install-extension
    ;;
  esac
  ;;
esac
