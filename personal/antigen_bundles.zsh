# Additional oh-my-zsh plugins to include
# Default bundles included can be seen in core/default_bundles.zsh
# See https://github.com/ohmyzsh/ohmyzsh/wiki/Plugins for available oh-my-zsh plugins.
# See https://github.com/zsh-users/antigen/wiki/Commands#antigen-bundle for instructions on including custom plugins.
#
# Include a plugin with `antigen bundle <plugin-name>`.

# Do not wrap `antigen theme` or `antigen bundle` in conditions. Antigen has cache invalidation issues.
# If you want to conditionally load bundles, uncomment the following line:
# ANTIGEN_CACHE=false
# You can read more in https://github.com/zsh-users/antigen/wiki/Commands#antigen-theme for info on how to define
# custom caching keys for different environments, if you desire that. The cache speeds up your terminal startup, so
# try to avoid disabling the cache unless you have no other choice.

# Staples theme: https://github.com/dersam/staples
# antigen theme dersam/staples staples


# Temporarily disable the antigen cache
#     clear cache with `rm -rf ~/.antigen/.cache`
# ANTIGEN_CACHE=false

antigen theme https://github.com/denysdovhan/spaceship-zsh-theme spaceship
SPACESHIP_TIME_SHOW=true
SPACESHIP_TIME_FORMAT='%D{%H:%M:%S}'
SPACESHIP_TIME_PREFIX="⏲ "
SPACESHIP_DIR_PREFIX=""
SPACESHIP_DIR_TRUNC_REPO=false
SPACESHIP_GIT_STATUS_SHOW=false
SPACESHIP_GIT_PREFIX=""
SPACESHIP_EXEC_TIME_PRECISION=3
SPACESHIP_EXEC_TIME_PREFIX=""
SPACESHIP_EXEC_TIME_ELAPSED=1
SPACESHIP_EXEC_TIME_COLOR="blue"
SPACESHIP_PROMPT_ORDER=(
  time          # Time stamps section
  dir           # Current directory section
  git           # Git section (git_branch + git_status)
  exec_time     # Execution time
  line_sep
  char          # Prompt character
)

antigen bundle zsh-autosuggestions
antigen bundle zsh-completions
antigen bundle gitfast
antigen bundle gitignore
antigen bundle z
