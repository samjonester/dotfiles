# Additional plugins can be found at https://github.com/ohmyzsh/ohmyzsh/wiki/Plugins
# Install plugins with `antigen bundle <plugin-name>`
source ~/antigen/antigen.zsh
# Install oh-my-zsh with paths set properly.
antigen use oh-my-zsh
# Install autocompletion for ripgrep
antigen bundle ripgrep
# Install shortcuts for common Ruby actions
antigen bundle ruby
# Prefix a command with sudo by double-tapping ESC
antigen bundle sudo

# Syntax highlighting on the prompt as you type commands
antigen bundle zsh-users/zsh-syntax-highlighting