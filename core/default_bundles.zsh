# Additional plugins can be found at https://github.com/ohmyzsh/ohmyzsh/wiki/Plugins
# Install plugins with `antigen bundle <plugin-name>`
source ~/antigen/antigen.zsh

# Install oh-my-zsh with paths set properly for Antigen bundles
antigen use oh-my-zsh

# Install autocompletion for Rails and Rake
# https://github.com/ohmyzsh/ohmyzsh/tree/master/plugins/rails
antigen bundle rails

# Install autocompletion for ripgrep
# https://github.com/ohmyzsh/ohmyzsh/tree/master/plugins/ripgrep
antigen bundle ripgrep

# Install shortcuts for common Ruby actions
# https://github.com/ohmyzsh/ohmyzsh/tree/master/plugins/ruby
antigen bundle ruby

# Prefix a command with sudo by double-tapping ESC
# https://github.com/ohmyzsh/ohmyzsh/tree/master/plugins/sudo
antigen bundle sudo

# Syntax highlighting on the prompt as you type commands
antigen bundle zsh-users/zsh-syntax-highlighting
