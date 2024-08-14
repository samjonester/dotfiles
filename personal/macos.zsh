# Custom configs for MacOS environments.
# This file will only be executed if the current environment is MacOS.

# Shopify Dev tooling setup
[[ -f /opt/dev/sh/chruby/chruby.sh ]] && { type chruby >/dev/null 2>&1 || chruby () { source /opt/dev/sh/chruby/chruby.sh; chruby "$@"; } }
[ -f /opt/dev/dev.sh ] && source /opt/dev/dev.sh

# ASDF Setup
. $(brew --prefix)/opt/asdf/libexec/asdf.sh
. /opt/homebrew/opt/asdf/libexec/asdf.sh
. /opt/homebrew/opt/asdf/libexec/asdf.sh

# Google cloud cli and autocompletions
if [ -f '/Users/sam/src/google/google-cloud-sdk/path.zsh.inc' ]; then . '/Users/sam/src/google/google-cloud-sdk/path.zsh.inc'; fi
if [ -f '/Users/sam/src/google/google-cloud-sdk/completion.zsh.inc' ]; then . '/Users/sam/src/google/google-cloud-sdk/completion.zsh.inc'; fi
