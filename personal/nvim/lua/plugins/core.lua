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
    "LazyVim/LazyVim",
    opts = {},
  },
  {
    "nvimdev/dashboard-nvim",
    opts = {
      config = {
        header = vim.split(logo, "\n"),
      },
    },
  },
  { "folke/flash.nvim", enabled = false },
  require("aerial").setup({
    resize_to_content = true,
    layout = {
      -- These control the width of the aerial window.
      -- They can be integers or a float between 0 and 1 (e.g. 0.4 for 40%)
      -- min_width and max_width can be a list of mixed types.
      -- max_width = {40, 0.2} means "the lesser of 40 columns or 20% of total"
      max_width = { 0.4, 1000 },
      min_width = { 0.2, 300 },
    },
  }),
}
