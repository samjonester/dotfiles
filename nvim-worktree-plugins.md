# Recommended Neovim Plugins for Git Worktrees

## Essential Plugins

1. **telescope.nvim** with **telescope-git-worktree.nvim**
   - Quick worktree switching and management
   - Shows all worktrees and lets you jump between them
   ```lua
   -- In your packer/lazy config
   use 'nvim-telescope/telescope.nvim'
   use 'ThePrimeagen/git-worktree.nvim'
   ```

2. **neo-tree.nvim** or **nvim-tree.lua**
   - File explorer that respects worktree boundaries
   - Shows correct files for current worktree

3. **lualine.nvim** or **feline.nvim**
   - Status line that can show current worktree name
   - Helps you always know which worktree you're in

## Keybindings Example

```lua
-- Telescope worktree keybindings
vim.keymap.set("n", "<leader>ww", "<cmd>lua require('telescope').extensions.git_worktree.git_worktrees()<cr>", { desc = "Switch worktree" })
vim.keymap.set("n", "<leader>wc", "<cmd>lua require('telescope').extensions.git_worktree.create_git_worktree()<cr>", { desc = "Create worktree" })
```

## Features Added to Your Config

1. **Lazy Loading**: The plugin only loads when you use the keybindings
2. **Auto-refresh Neo-tree**: When switching worktrees, neo-tree automatically refreshes
3. **Lualine Integration**: Shows current worktree name in your statusline (only when in a worktree)
4. **Worktree Hooks**: Automatically updates your editor when switching worktrees
5. **Neo-tree Configuration**: Ensures file explorer follows worktree boundaries