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

# Non-interactive git editor guard.
# When stdout is not a terminal (pi's bash tool, agent shells, scripts), never
# let git spawn an interactive editor. A captured vim/nano writes raw alt-screen
# + scroll-region escapes (ESC[?1049h, ESC[1;24r) to stdout, which pi persists
# into the session and replays on every resume — permanently clamping the
# terminal to the top rows. `true` makes git accept the prepared message and
# move on. The `[ -t 1 ]` gate leaves your real interactive editor untouched.
[ -t 1 ] || export GIT_EDITOR=true

[ -f "$HOME/dotfiles/personal/aliases.zsh" ] && . "$HOME/dotfiles/personal/aliases.zsh"
