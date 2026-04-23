# Custom actions to take on initial install of dotfiles.
# This runs after default install actions, so you can overwrite changes it makes if you want.

ZSH_HOST_OS=$(uname | awk '{print tolower($0)}')

# ── Pi agent configuration (shared across OS) ────────────────────────────────
#
# Links portable dotfiles config into ~/.pi/agent, then overlays any
# extensions/agents from installed pi packages (e.g. shop-pi-fy).
# Dotfiles never store symlinks to package clones — those are wired at
# install time only.
setup_pi() {
  local pi_dir="$HOME/.pi/agent"
  local dotfiles_pi="$HOME/$DOTFILES_DIRECTORY_NAME/personal/pi"

  mkdir -p "$pi_dir/extensions"

  # Dotfiles-owned config
  ln -vsfn "$dotfiles_pi/AGENTS.md"       "$pi_dir/AGENTS.md"
  ln -vsfn "$dotfiles_pi/settings.json"   "$pi_dir/settings.json"
  ln -vsfn "$dotfiles_pi/skills"          "$pi_dir/skills"
  ln -vsfn "$dotfiles_pi/prompts"         "$pi_dir/prompts"
  ln -vsfn "$dotfiles_pi/auto-lint.json"  "$pi_dir/auto-lint.json"

  # Knowledge: real directory layering dotfiles-versioned (public) + local private files
  mkdir -p "$HOME/.pi/memory/knowledge"
  if [ -d "$dotfiles_pi/knowledge" ]; then
    for f in "$dotfiles_pi/knowledge"/*.md; do
      [ -e "$f" ] && ln -vsfn "$f" "$HOME/.pi/memory/knowledge/$(basename "$f")"
    done
  fi

  # Dotfiles-owned extensions (portable, first-party only)
  for ext_name in bash-guard git-safety.ts; do
    [ -e "$dotfiles_pi/extensions/$ext_name" ] && \
      ln -vsfn "$dotfiles_pi/extensions/$ext_name" "$pi_dir/extensions/$ext_name"
  done

  # Agents: real directory layering dotfiles + optional package agents
  [ -L "$pi_dir/agents" ] && rm "$pi_dir/agents"
  mkdir -p "$pi_dir/agents"

  for f in "$dotfiles_pi/agents"/*.md; do
    [ -e "$f" ] && ln -vsfn "$f" "$pi_dir/agents/$(basename "$f")"
  done

  # Overlay agents/extensions from shop-pi-fy if installed as a pi package
  local pkg_dir="$pi_dir/git/github.com/shopify-playground/shop-pi-fy"
  if [ -d "$pkg_dir" ]; then
    # Package agents (review-* etc.)
    for f in "$pkg_dir/agents"/*.md; do
      [ -e "$f" ] && ln -vsfn "$f" "$pi_dir/agents/$(basename "$f")"
    done

    # Non-packaged extensions — skip ones already declared in package.json
    # .pi.extensions (auto-loaded by pi) and web-search (conflicts with pi-web-access)
    local skip="grokt observe perplexity-research shopify-data slack subagent vault web-search"
    for f in "$pkg_dir/extensions"/*; do
      [ -d "$f" ] || continue
      local ext_name=$(basename "$f")
      case " $skip " in *" $ext_name "*) continue ;; esac
      ln -vsfn "$f" "$pi_dir/extensions/$ext_name"
    done
  fi

  # Shopify-specific project AGENTS.md
  if [ -d ~/src/shopify ]; then
    ln -vsfn "$HOME/$DOTFILES_DIRECTORY_NAME/AGENTS.md.shopify" ~/src/shopify/AGENTS.md
  fi
}

# ── Shopify-specific tooling (skipped on non-Shopify machines) ────────────────
setup_shopify_tooling() {
  # Worktree pool tooling
  mkdir -p ~/src/github.com/shopify-playground
  if [ ! -d ~/src/github.com/shopify-playground/wtp ]; then
    git clone https://github.com/shopify-playground/wtp.git ~/src/github.com/shopify-playground/wtp || true
  fi

  # Install shop-pi-fy pi package (extensions, agents, skills for Shopify workflows)
  if command -v pi >/dev/null 2>&1; then
    pi install https://github.com/shopify-playground/shop-pi-fy 2>/dev/null || true
  fi
}

case $ZSH_HOST_OS in
darwin*)
  # Terminal
  chsh -s $(which zsh)
  $BREW_EXECUTABLE install --cask font-jetbrains-mono-nerd-font
  $BREW_EXECUTABLE install kitty
  ln -vsfn ~/$DOTFILES_DIRECTORY_NAME/personal/kitty ~/.config/
  git clone --depth 1 https://github.com/dexpota/kitty-themes.git ~/.config/kitty/kitty-themes
  ln -vsfn ~/$DOTFILES_DIRECTORY_NAME/personal/.irbrc ~/

  setup_pi

  # Terminal Tooling
  $BREW_EXECUTABLE install bat
  $BREW_EXECUTABLE install eza
  $BREW_EXECUTABLE install ranger
  ln -vsfn ~/$DOTFILES_DIRECTORY_NAME/personal/ranger ~/.config/
  git clone https://github.com/alexanderjeurissen/ranger_devicons ~/.config/ranger/plugins/ranger_devtools
  $BREW_EXECUTABLE install zoxide

  # Git tooling
  $BREW_EXECUTABLE install tig
  $BREW_EXECUTABLE install lazygit
  $BREW_EXECUTABLE install delta
  ln -vsfn ~/$DOTFILES_DIRECTORY_NAME/personal/delta ~/.config/
  $BREW_EXECUTABLE install gh
  gh auth login --web -h github.com
  gh extension install github/gh-copilot --force

  # Search
  $BREW_EXECUTABLE install fzf
  $BREW_EXECUTABLE install fzy
  $BREW_EXECUTABLE install fd
  $BREW_EXECUTABLE install ripgrep
  git clone https://github.com/junegunn/fzf-git.sh.git ~/src/github.com/junegunn/fzf-git.sh

  # Shopify tooling (safe no-op if repos are inaccessible)
  setup_shopify_tooling

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
    ln -vsfn ~/$DOTFILES_DIRECTORY_NAME/personal/.irbrc ~/

    setup_pi

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
    ln -vsfn ~/$DOTFILES_DIRECTORY_NAME/personal/delta ~/.config/

    # Search
    git clone --depth 1 https://github.com/junegunn/fzf.git ~/.fzf
    ~/.fzf/install --no-update-rc --key-bindings --completion
    sudo apt-get install -y fzy fd-find ripgrep
    git clone https://github.com/junegunn/fzf-git.sh.git ~/src/github.com/junegunn/fzf-git.sh

    # Shopify tooling (safe no-op if repos are inaccessible)
    setup_shopify_tooling

    # Setup Neovim
    sudo apt-get install -y neovim
    ln -vsfn ~/$DOTFILES_DIRECTORY_NAME/personal/nvim ~/.config/

    ;;
  esac
  ;;
esac
