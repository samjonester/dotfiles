# ~/.zshenv — sourced for EVERY zsh invocation (interactive, login, and
# non-interactive `zsh -c` script wrappers). Keep this file fast and silent.
#
# This file is symlinked to ~/.zshenv by personal/install.sh so it follows
# you across machines, just like .zshrc.

# Cargo (Rust) — needed on PATH for non-interactive shells too.
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"

# Aliases and functions available in every zsh shell, including pi shell-mode
# (`!cmd`, `!i cmd`, `!f cmd`) which spawns `$SHELL -c <command>`.
[ -f "$HOME/dotfiles/personal/aliases.zsh" ] && . "$HOME/dotfiles/personal/aliases.zsh"

# BASH_ENV — makes aliases work in non-interactive `bash -c '...'` too.
# Pi's default `$ cmd` prompt uses /bin/bash, not $SHELL, so without this
# the alias setup above wouldn't help there. Exported so child bash processes
# (spawned by pi or other tools that inherit our env) pick it up.
export BASH_ENV="$HOME/dotfiles/personal/bash_env.sh"
