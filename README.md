dotfiles starter template - compatible with MacOS and Spin.

- starting point - be productive now, and add/subtract what you care about
- updatable, with customization hooks - hack on it without breaking upgrades (compile step for configs?)
- clearly documented, highly commented for dotfiles 
- zsh scripting only - no additional dependencies
- antigen for ease of plugin use/themes (staples as default theme)
- set up git remote for pulling updates

--------------
The `core` directory contains the framework scripts. Don't alter these unless you want to leave the upgrade path and
do your own thing.

The `personal/` directory is where any of your own customizations should go. Any file with the extension `.zsh` will
be loaded. These files are loaded right at the end of the terminal session setup (at the end of `.zshrc`).
