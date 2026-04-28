# BASH_ENV — sourced by every non-interactive bash invocation (`bash -c '...'`).
# This is the bash equivalent of .zshenv and is what makes aliases work in
# pi's default `$ cmd` prompt (which uses /bin/bash, not $SHELL).
#
# bash doesn't expand aliases in non-interactive mode by default, so we have
# to opt in explicitly. After that, the same aliases.zsh works in bash because
# alias/function syntax is identical for the constructs we use.
#
# Keep this file fast and silent — it runs for EVERY bash -c invocation.

shopt -s expand_aliases 2>/dev/null

[ -f "$HOME/dotfiles/personal/aliases.zsh" ] && . "$HOME/dotfiles/personal/aliases.zsh"
