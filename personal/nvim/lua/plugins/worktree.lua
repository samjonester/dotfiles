-- Git Worktree plugin configuration for Claude Code workflows
return {
  {
    "ThePrimeagen/git-worktree.nvim",
    dependencies = {
      "nvim-telescope/telescope.nvim",
      "nvim-lua/plenary.nvim",
    },
    keys = {
      {
        "<leader>ww",
        function()
          require("telescope").extensions.git_worktree.git_worktrees()
        end,
        desc = "Switch worktree",
      },
      {
        "<leader>wc",
        function()
          require("telescope").extensions.git_worktree.create_git_worktree()
        end,
        desc = "Create worktree",
      },
    },
    config = function()
      require("git-worktree").setup({
        -- These are the defaults, but you can customize:
        change_directory_command = "cd",
        update_on_change = true,
        update_on_change_command = "e .",
        clearjumps_on_change = true,
        autopush = false,
      })

      -- Load the telescope extension
      require("telescope").load_extension("git_worktree")

      -- Hook to update neo-tree when switching worktrees
      require("git-worktree").on_tree_change(function(op, metadata)
        if op == require("git-worktree").Operations.Switch then
          vim.schedule(function()
            -- Refresh neo-tree if it's open
            if package.loaded["neo-tree"] then
              vim.cmd("Neotree action=refresh")
            end
            -- Clear and redraw screen
            vim.cmd("nohlsearch")
          end)
        end
      end)
    end,
  },

  -- Enhance lualine to show current worktree
  -- DISABLED: Shell spawning causing cursor lag
  -- {
  --   "nvim-lualine/lualine.nvim",
  --   optional = true,
  --   opts = function(_, opts)
  --     -- More efficient worktree name function
  --     local function worktree_name()
  --       local handle = io.popen("git rev-parse --show-toplevel 2>/dev/null")
  --       if not handle then return "" end
  --
  --       local git_root = handle:read("*l")
  --       handle:close()
  --
  --       if git_root and git_root:match("/.claude/worktrees/") then
  --         local name = git_root:match("/([^/]+)$")
  --         if name then
  --           return "⎇ " .. name
  --         end
  --       end
  --       return ""
  --     end
  --
  --     -- Add to lualine_b section (after branch name)
  --     opts.sections = vim.tbl_deep_extend("force", opts.sections or {}, {
  --       lualine_b = vim.list_extend(
  --         opts.sections.lualine_b or { "branch", "diff", "diagnostics" },
  --         {
  --           {
  --             worktree_name,
  --             color = { fg = "#8ec07c", gui = "bold" },
  --             cond = function()
  --               return vim.fn.system("git rev-parse --git-dir 2>/dev/null"):match("/.claude/worktrees/") ~= nil
  --             end,
  --           },
  --         }
  --       ),
  --     })
  --
  --     return opts
  --   end,
  -- },

  -- Ensure neo-tree respects worktree boundaries
  {
    "nvim-neo-tree/neo-tree.nvim",
    optional = true,
    opts = {
      filesystem = {
        follow_current_file = {
          enabled = true,
          leave_dirs_open = false,
        },
        -- This ensures neo-tree follows git worktree switches
        bind_to_cwd = true,
        cwd_target = {
          sidebar = "global",
          current = "global",
        },
      },
    },
  },
}