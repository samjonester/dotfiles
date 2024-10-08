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
    "kevinhwang91/nvim-ufo",
    dependencies = "kevinhwang91/promise-async", -- Ensure to include the dependency
    config = function()
      -- Configuration for nvim-ufo
      require("ufo").setup()
    end,
  },
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
}
