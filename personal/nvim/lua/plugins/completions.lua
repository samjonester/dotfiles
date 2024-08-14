local cmp = require("cmp")
cmp.setup({
  sources = {
    { name = "copilot" },
    { name = "nvim_lsp" },
    { name = "nvim_lua" },
    { name = "path" },
    { name = "spell" },
    { name = "emoji" },
    { name = "calc" },
  },
  mapping = {
    ["<Tab>"] = cmp.mapping.select_next_item(),
    ["<S-Tab>"] = cmp.mapping.select_prev_item(),
    ["<C-a>"] = cmp.mapping.confirm({
      behavior = cmp.ConfirmBehavior.Replace,
      select = true,
    }),
    ["<CR>"] = cmp.mapping(function(fallback)
      fallback()
    end),
  },
})
