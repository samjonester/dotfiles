dotfiles starter template - compatible with MacOS and Spin.

- starting point - be productive now, and add/subtract what you care about
- updatable, with customization hooks - hack on it without breaking upgrades (compile step for configs?)
- clearly documented, highly commented for dotfiles 
- zsh scripting only - no additional dependencies
- antigen for ease of plugin use/themes (staples as default theme)
- set up git remote for pulling updates

---
Set up the repo by cloning to `~/dotfiles`:
```
git clone https://github.com/Shopify/dotfiles-starter-template.git ~/dotfiles
```

- how to pull from original template, vs push to your own personal version

--------------
The `core` directory contains the framework scripts. Don't alter these unless you want to leave the upgrade path and
do your own thing.