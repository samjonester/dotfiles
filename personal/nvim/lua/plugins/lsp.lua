return {
  {
    "neovim/nvim-lspconfig",
    servers = {
      ruby_lsp = {
        mason = false,
        cmd = { vim.fn.expand("~/.asdf/shims/ruby-lsp") },
      },
    },
  },
}
