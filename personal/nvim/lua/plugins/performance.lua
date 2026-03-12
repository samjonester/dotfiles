-- Performance optimizations for Neovim
return {
  {
    "nvim-mini/mini.hipatterns",
    opts = {
      -- Reduce update frequency to improve cursor movement performance
      delay = {
        text_change = 500, -- Delay pattern updates by 500ms
      },
    },
  },
}