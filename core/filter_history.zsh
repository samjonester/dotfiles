# Search in history based on a partially written command.

# Ensure that history is shared across sessions
# SHARE_HISTORY: history is shared across sessions, including active sessions
setopt SHARE_HISTORY

# Bind up arrow
bindkey '\eOA' history-beginning-search-backward
bindkey '\e[A' history-beginning-search-backward

# Bind down arrow
bindkey '\eOB' history-beginning-search-forward
bindkey '\e[B' history-beginning-search-forward