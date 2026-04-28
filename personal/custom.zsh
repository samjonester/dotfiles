# Define any custom environment scripts here.
# This file is loaded after everything else, but before Antigen is applied and ~/extra.zsh sourced.
# Put anything here that you want to exist on all your environment, and to have the highest priority
# over any other customization.

# Word navigation: Alt+Left/Right (raw xterm sequences, needed inside tmux)
bindkey '^[[1;3D' backward-word
bindkey '^[[1;3C' forward-word

export PYENV_ROOT="$HOME/.pyenv"
[[ -d $PYENV_ROOT/bin ]] && export PATH="$PYENV_ROOT/bin:$PATH"
eval "$(pyenv init - zsh)"

if [[ -n "$KITTY_INSTALLATION_DIR" ]]; then
    _kitty_preexec_backup="$functions[preexec]"
fi

preexec() {
  if [[ -n "$_kitty_preexec_backup" ]]; then
    eval "$_kitty_preexec_backup"
  fi
  echo "\033[1;33m$(date '+%H:%M:%S')\033[0m\n"
}

# pipx
# export PATH="$PATH:/Users/sam/.local/bin"

# Aliases and functions live in personal/aliases.zsh so they're also available
# to non-interactive shells (pi shell-mode, scripts) via personal/.zshenv.
# Re-sourcing here is idempotent and ensures interactive shells get them even
# if .zshenv was bypassed somehow.
[ -f "$DF_USER/aliases.zsh" ] && source "$DF_USER/aliases.zsh"
# alias c=clear
# alias v=nvim
# alias n=npm

# FZF Setup
[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh
source ~/src/github.com/junegunn/fzf-git.sh/fzf-git.sh
export FZF_DEFAULT_COMMAND="fd --hidden --strip-cwd-prefix --exclude .git"
export FZF_CTRL_T_COMMAND="$FZF_DEFAULT_COMMAND"
export FZF_CTRL_T_OPTS="--preview 'bat -n --color=always --line-range :500 {}'"
export FZF_ALT_C_COMMAND="fd --type=d --hidden --strip-cwd-prefix --exclude .git"
export FZF_ALT_C_OPTS="--preview 'eza --tree --level=2 --color=always {} | head -500'"

local color00='#32302f'
local color01='#3c3836'
local color02='#504945'
local color03='#665c54'
local color04='#bdae93'
local color05='#d5c4a1'
local color06='#ebdbb2'
local color07='#fbf1c7'
local color08='#fb4934'
local color09='#fe8019'
local color0A='#fabd2f'
local color0B='#b8bb26'
local color0C='#8ec07c'
local color0D='#83a598'
local color0E='#d3869b'
local color0F='#d65d0e'

export FZF_DEFAULT_OPTS="$FZF_DEFAULT_OPTS"\
" --color=bg+:$color01,bg:$color00,spinner:$color0C,hl:$color0D"\
" --color=fg:$color04,header:$color0D,info:$color0A,pointer:$color0C"\
" --color=marker:$color0C,fg+:$color06,prompt:$color0A,hl+:$color0D"

_fzf_compgen_path() {
  fd --hidden --exclude .git . "$1"
}

_fzf_compgen_dir() {
  fd --type=d --hidden --exclude .git . "$1"
}

# Bat setup (env var only — bat alias lives in aliases.zsh)
export BAT_THEME=gruvbox-dark

# WTP shell integration (needs compdef from compinit, so must load after antigen apply)
[ -f "$HOME/src/github.com/shopify-playground/wtp/shell/wtp.zsh" ] && source "$HOME/src/github.com/shopify-playground/wtp/shell/wtp.zsh"

