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
    sudo apt-get install -y kitty
    ln -vsfn ~/$DOTFILES_DIRECTORY_NAME/personal/kitty ~/.config/

    # Terminal Tooling
    sudo apt-get install -y bat ranger
    ln -vsfn ~/$DOTFILES_DIRECTORY_NAME/personal/ranger ~/.config/
    git clone https://github.com/alexanderjeurissen/ranger_devicons ~/.config/ranger/plugins/ranger_devicons

    # Git tooling
    sudo apt-get install -y tig
    LAZYGIT_VERSION=$(curl -s "https://api.github.com/repos/jesseduffield/lazygit/releases/latest" | grep -Po '"tag_name": "v\K[^"]*')
    curl -Lo lazygit.tar.gz "https://github.com/jesseduffield/lazygit/releases/latest/download/lazygit_${LAZYGIT_VERSION}_Linux_x86_64.tar.gz"
    tar xf lazygit.tar.gz lazygit
    sudo install lazygit /usr/local/bin
    curl -Lo /tmp/delta.deb https://github.com/dandavison/delta/releases/download/0.18.1/git-delta_0.18.1_amd64.deb
    sudo dpkg -i /tmp/delta.deb

    # Search
    git clone --depth 1 https://github.com/junegunn/fzf.git ~/.fzf
    ~/.fzf/install --no-update-rc --key-bindings --completion
    sudo apt-get install -y fzy fd-find ripgrep
    git clone https://github.com/junegunn/fzf-git.sh.git ~/src/github.com/junegunn/fzf-git.sh

    # Setup Neovim
    sudo apt-get install -y neovim
    ln -vsfn ~/$DOTFILES_DIRECTORY_NAME/personal/nvim ~/.config/

    ;;
  esac
  ;;
esac
