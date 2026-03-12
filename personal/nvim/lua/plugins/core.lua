local logo = [[






                     $$\                     $$\       $$\   $$\                 $$\                               
                     $$ |                    $$ |      \__|  $$ |                $$ |                              
 $$$$$$\   $$$$$$\ $$$$$$\          $$$$$$$\ $$$$$$$\  $$\ $$$$$$\          $$$$$$$ | $$$$$$\  $$$$$$$\   $$$$$$\  
$$  __$$\ $$  __$$\\_$$  _|        $$  _____|$$  __$$\ $$ |\_$$  _|        $$  __$$ |$$  __$$\ $$  __$$\ $$  __$$\ 
$$ /  $$ |$$$$$$$$ | $$ |          \$$$$$$\  $$ |  $$ |$$ |  $$ |          $$ /  $$ |$$ /  $$ |$$ |  $$ |$$$$$$$$ |
$$ |  $$ |$$   ____| $$ |$$\        \____$$\ $$ |  $$ |$$ |  $$ |$$\       $$ |  $$ |$$ |  $$ |$$ |  $$ |$$   ____|
\$$$$$$$ |\$$$$$$$\  \$$$$  |      $$$$$$$  |$$ |  $$ |$$ |  \$$$$  |      \$$$$$$$ |\$$$$$$  |$$ |  $$ |\$$$$$$$\ 
 \____$$ | \_______|  \____/       \_______/ \__|  \__|\__|   \____/        \_______| \______/ \__|  \__| \_______|
$$\   $$ |                                                                                                         
\$$$$$$  |                                                                                                         
 \______/                                                                                                          

]]
return {
  {
    "nvimdev/dashboard-nvim",
    opts = {
      config = {
        header = vim.split(logo, "\n"),
      },
    },
  },
  { "folke/flash.nvim", enabled = false },
  {
    "nvim-neo-tree/neo-tree.nvim",
    opts = {
      filesystem = {
        window = {
          mappings = {
            ["H"] = "toggle_hidden",
          },
        },
      },
    },
  },
  -- Disabled nvim-ufo: major cause of cursor movement lag
  { "kevinhwang91/nvim-ufo", enabled = false },
  { "kevinhwang91/promise-async", enabled = false },
  {
    "kelly-lin/ranger.nvim",
    config = function()
      require("ranger-nvim").setup()
      vim.api.nvim_set_keymap("n", "<leader>ef", "", {
        desc = "Open Ranger",
        noremap = true,
        callback = function()
          require("ranger-nvim").open(true)
        end,
      })
    end,
  },
  {
    "diegoulloao/nvim-file-location",
    config = function()
      local status, nvim_file_location = pcall(require, "nvim-file-location")
      if not status then
        return
      end

      nvim_file_location.setup({
        keymap = "<leader>fl",      -- Copy file location with line number
        mode = "workdir",           -- Use relative path from working directory
        add_line = true,            -- Include line number
        add_column = false,         -- Don't include column number
        default_register = "+",     -- Use system clipboard
      })

      -- Custom visual mode mapping for line ranges
      vim.api.nvim_create_user_command('CopyVisualLocation', function(args)
        local start_line = args.line1
        local end_line = args.line2

        -- Get the file path (relative to working directory)
        local file_path = vim.fn.fnamemodify(vim.fn.expand("%"), ":.")

        -- Format with line range
        local location
        if start_line == end_line then
          location = string.format("%s:%d", file_path, start_line)
        else
          location = string.format("%s:%d-%d", file_path, start_line, end_line)
        end

        -- Copy to system clipboard
        vim.fn.setreg("+", location)

        -- Show notification
        vim.notify("Copied: " .. location, vim.log.levels.INFO)
      end, { range = true })

      vim.keymap.set("x", "<leader>fl", ":'<,'>CopyVisualLocation<CR>", { desc = "Copy file location with line range" })
    end,
  },
}
