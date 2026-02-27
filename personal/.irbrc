IRB.conf[:SAVE_HISTORY] = 5000
IRB.conf[:HISTORY_FILE] = "#{ENV['HOME']}/.irb-history"
Reline::Face.config(:completion_dialog) do |conf|
  conf.define :default, foreground: :white, background: :black
  conf.define :enhanced, foreground: :black, background: :cyan
  conf.define :scrollbar, foreground: :white, background: :black
end

