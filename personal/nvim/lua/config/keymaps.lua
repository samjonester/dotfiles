-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here

-- Telescope keybindings for when you need its specific features
-- FZF remains the default for speed, but Telescope offers more features
vim.keymap.set("n", "<leader>ft", "<cmd>Telescope find_files<cr>", { desc = "Find Files (Telescope)" })
vim.keymap.set("n", "<leader>fs", "<cmd>Telescope live_grep<cr>", { desc = "Search Text (Telescope)" })
vim.keymap.set("n", "<leader>fh", "<cmd>Telescope help_tags<cr>", { desc = "Help Tags (Telescope)" })

-- Additional useful Telescope commands under <leader>f
vim.keymap.set("n", "<leader>fH", "<cmd>Telescope highlights<cr>", { desc = "Highlights (Telescope)" })
vim.keymap.set("n", "<leader>fk", "<cmd>Telescope keymaps<cr>", { desc = "Keymaps (Telescope)" })
vim.keymap.set("n", "<leader>fC", "<cmd>Telescope commands<cr>", { desc = "Commands (Telescope)" })
vim.keymap.set("n", "<leader>fo", "<cmd>Telescope vim_options<cr>", { desc = "Vim Options (Telescope)" })
vim.keymap.set("n", "<leader>fa", "<cmd>Telescope autocommands<cr>", { desc = "Autocommands (Telescope)" })

-- LSP-specific Telescope commands (these have no FZF equivalent)
vim.keymap.set("n", "<leader>fd", "<cmd>Telescope diagnostics<cr>", { desc = "Diagnostics (Telescope)" })
vim.keymap.set("n", "<leader>fi", "<cmd>Telescope lsp_implementations<cr>", { desc = "Implementations (Telescope)" })
vim.keymap.set("n", "<leader>fD", "<cmd>Telescope lsp_definitions<cr>", { desc = "Definitions (Telescope)" })
vim.keymap.set("n", "<leader>fT", "<cmd>Telescope lsp_type_definitions<cr>", { desc = "Type Definitions (Telescope)" })

-- Symbol search with Telescope (great for code navigation)
vim.keymap.set("n", "<leader>fw", "<cmd>Telescope lsp_document_symbols<cr>", { desc = "Document Symbols (Telescope)" })
vim.keymap.set("n", "<leader>fW", "<cmd>Telescope lsp_workspace_symbols<cr>", { desc = "Workspace Symbols (Telescope)" })

-- Git-specific Telescope commands (with better preview than FZF)
vim.keymap.set("n", "<leader>fgc", "<cmd>Telescope git_commits<cr>", { desc = "Git Commits (Telescope)" })
vim.keymap.set("n", "<leader>fgb", "<cmd>Telescope git_branches<cr>", { desc = "Git Branches (Telescope)" })
vim.keymap.set("n", "<leader>fgs", "<cmd>Telescope git_status<cr>", { desc = "Git Status (Telescope)" })
