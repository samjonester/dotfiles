#
# Defines environment variables.
#
# Ensure that a non-login, non-interactive shell has a defined environment.
if [[ "$SHLVL" -eq 1 && ! -o LOGIN && -s "${ZDOTDIR:-$HOME}/.zprofile" ]]; then
  source "${ZDOTDIR:-$HOME}/.zprofile"
fi

# Local Environment Variables
[[ -s "${ZDOTDIR:-$HOME}/.localrc" ]] && source "${ZDOTDIR:-$HOME}/.localrc"

eval $(/usr/libexec/path_helper -s)

# Set the list of directories that Zsh searches for programs.
path=(
  /usr/local/{bin,sbin}
  $path
)

# JENV.be
# export PATH="$HOME/.jenv/bin:$PATH"
# eval "$(jenv init -)"

. "$HOME/.cargo/env"
