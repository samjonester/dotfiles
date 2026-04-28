# Aliases and functions that should be available in EVERY zsh invocation,
# including non-interactive shells (`zsh -c`, script wrappers, pi shell-mode,
# CI runners, cron jobs, etc.).
#
# Sourced from:
#   - personal/.zshenv  (every zsh invocation)
#   - personal/custom.zsh (interactive shells, idempotent re-source)
#
# Rules for this file:
#   - Pure alias / function definitions only — no side effects
#   - No stdout/stderr output (would break scripts that capture zsh output)
#   - No slow init (pyenv, rbenv, plugin managers, compinit)
#   - No bindkey, no preexec, no setopts that change parsing globally
#   - Avoid shadowing stdlib commands that scripts rely on (`cat`, `grep`, etc.)
#     — additive aliases (`g=git`, `lg=lazygit`) are safe; redefinitions aren't.

# ── Terminal tooling ─────────────────────────────────────────────────────────
alias g=git
alias gco='git checkout $(git branch --format="%(refname:short)" | fzf)'
alias r=ranger
alias dpi='TMPDIR=$HOME/.pi/tmp devx pi'
alias lg='lazygit'

alias '?s'='gh copilot suggest'
alias '?e'='gh copilot explain'

# eza self-alias adds flags; e/et/et2 chain through it.
alias eza='eza --color=always --long --git --no-filesize --icons=always --no-time --no-user'
alias e='eza'
alias et='eza --tree --color=always'
alias et2='eza --tree --color=always --level=2'
alias ls='ls -lAh --color=auto'

# bat self-alias forces color (bat already auto-detects, but this makes piping consistent).
alias bat='bat --color=always'

# ── Utility aliases ──────────────────────────────────────────────────────────
alias fixcam='sudo killall VDCAssistant'
alias fixwifi='sudo ifconfig en0 down && sudo ifconfig en0 up'
alias enable-key-repeat='defaults write -g ApplePressAndHoldEnabled -bool false'
alias disable-key-repeat='defaults write -g ApplePressAndHoldEnabled -bool true'

# ── Utility functions ────────────────────────────────────────────────────────
mcd() {
  mkdir -p "$1"
  cd "$1"
}

ps-kill() {
  ps aux | grep "$1" | grep -v grep | awk '{ print $2 }' | xargs kill -9
}

# Examples:
#   bare-clone git@github.com:name/repo.git           → clones to ./repo
#   bare-clone git@github.com:name/repo.git my-repo   → clones to ./my-repo
bare-clone() {
  local url=$1
  local basename=${url##*/}
  local name=${2:-${basename%.*}}

  mkdir "$name"
  cd "$name"

  # Move the administrative git files (a.k.a. $GIT_DIR) under .bare directory
  # so worktrees can be created as siblings.
  git clone --bare "$url" .bare
  echo "gitdir: ./.bare" > .git

  # Explicitly set the remote origin fetch so we can fetch remote branches
  git config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"

  git fetch origin
}

killport() {
  local port=$1
  if [ -z "$port" ]; then
    lsof -i TCP | fzf --multi | awk '{print $2}' | xargs kill -9
  else
    lsof -i :$port | awk '{print $2}' | xargs kill -9
  fi
}
