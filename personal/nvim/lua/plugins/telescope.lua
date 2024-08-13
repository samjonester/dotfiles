return {
  {
    "nvim-telescope/telescope.nvim",
    requires = {
      { "nvim-telescope/telescope-fzf-native.nvim", run = "make" }, -- Optional for fzf sorting
      "nvim-telescope/telescope-themes.nvim",
    },
    config = function()
      require("telescope").setup({})
    end,
  },
}
