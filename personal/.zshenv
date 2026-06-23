# ~/.zshenv — sourced for EVERY zsh invocation (interactive, login, and
# non-interactive `zsh -c` script wrappers). Keep this file fast and silent.
#
# This file is symlinked to ~/.zshenv by personal/install.sh so it follows
# you across machines, just like .zshrc.

# Non-interactive git editor guard.
# When stdout is not a terminal (pi shell-mode `!cmd`, agent shells, scripts),
# never let git spawn an interactive editor. A captured vim/nano writes raw
# alt-screen + scroll-region escapes (ESC[?1049h, ESC[1;24r) to stdout, which pi
# persists into the session and replays on every resume — permanently clamping
# the terminal to the top rows. `true` makes git accept the prepared message.
# The `[ -t 1 ]` gate leaves interactive zsh and pi `!i`/`!f` fullscreen mode
# (which allocate a PTY) untouched, so `git commit` / `git rebase -i` still work.
[ -t 1 ] || export GIT_EDITOR=true

# Cargo (Rust) — needed on PATH for non-interactive shells too.
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"

# Ruby gems user-install bin (ruby-lsp, etc.)
if command -v ruby >/dev/null 2>&1; then
  _gem_bin="$(ruby -e 'puts Gem.user_dir')/bin"
  [[ -d "$_gem_bin" ]] && export PATH="$_gem_bin:$PATH"
  unset _gem_bin
fi

# Aliases and functions available in every zsh shell, including pi shell-mode
# (`!cmd`, `!i cmd`, `!f cmd`) which spawns `$SHELL -c <command>`.
[ -f "$HOME/dotfiles/personal/aliases.zsh" ] && . "$HOME/dotfiles/personal/aliases.zsh"

# BASH_ENV — makes aliases work in non-interactive `bash -c '...'` too.
# Pi's default `$ cmd` prompt uses /bin/bash, not $SHELL, so without this
# the alias setup above wouldn't help there. Exported so child bash processes
# (spawned by pi or other tools that inherit our env) pick it up.
export BASH_ENV="$HOME/dotfiles/personal/bash_env.sh"
