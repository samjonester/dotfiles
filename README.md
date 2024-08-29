Opinionated zsh dotfiles starter template - compatible with MacOS and Spin.

Uses [oh-my-zsh](https://ohmyz.sh/) with [Antigen](https://github.com/zsh-users/antigen) to manage dependencies and themes.
Default theme is [Staples](https://github.com/dersam/staples).

### Installation

WARNING: If you already have personal dotfiles set up, installing this repo will likely overwrite them.
Make copies of anything you want to keep. If you don't know if you set dotfiles up, you probably haven't.

1. `dev clone`
2. `dev up`. This will install dependencies, symlink configs and .zshrc, *overwriting anything you already have*.

To make your own copy to save your customizations, create a branch with your Github handle to the [dotfiles repo](https://github.com/Shopify/dotfiles), and push to it.

### Update
You can make whatever changes you like in your branch (see Customization below). To pull in updates if you haven't diverged, you can rebase on main.

```
git pull upstream main --rebase
```

### Customization
The `core` directory contains the framework scripts. Don't alter these unless you want to leave the upgrade path and
do your own thing.

The `personal` directory is where all of your customizations should go. The main repo will not alter these.

#### Themes

You can use any theme from https://github.com/ohmyzsh/ohmyzsh/wiki/Themes by setting `antigen theme xxxx` in `personal/antigen_bundles.zsh`.

The default theme, [Staples](https://github.com/dersam/staples), is a custom theme by @dersam that is pulled from a git repo. You can copy that config if you have a preferred theme in a separate repo.

#### Available customizations
Files are listed in the order they are loaded. Conflicts between files, such as
environment variable definitions, will be resolved by "last definition wins".

Load order can be seen in `.zshrc`.

- `environment.zsh`: Define any environment variables you always want.
- `macos.zsh`: Customizations that should only be run on MacOS.
- `antigen_bundles.zsh`: Define additional zsh plugins to include. Your theme selection should be set here as well (default is Staples).
- `dircolors`: Define a custom dircolors file. Optional, falls back to system default.
- `spin.zsh`: Customizations that should only be applied to Spin environments.
- `custom.zsh`: Customizations that should apply everywhere. This is the LAST file
loaded, so any conflicting changes made here will override any previous files.

#### Custom install
`personal/install.sh` is a special case. It is run as part of the `install.sh` script, and should be where you put
any customizations around initial setup and installation. For example, if you want to symlink a config from `personal`
into your home directory, that's where you'd run that command.
