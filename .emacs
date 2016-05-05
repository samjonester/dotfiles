;; Configure package manager
(require 'package)
(setq package-enable-at-startup nil)

(setq package-archives '(("gnu" . "https://elpa.gnu.org/packages/")
                         ("melpa" . "http://melpa.org/packages/")
                         ("marmalade" . "http://marmalade-repo.org/packages/")
                         ("melpa-stable" . "http://stable.melpa.org/packages/")
                         ("org" . "http://orgmode.org/elpa/")))

(package-initialize)

;; Import use-package to automatically install and configure packages
(unless (package-installed-p 'use-package)
  (package-refresh-contents)
  (package-install 'use-package))




;; Global miscelanious settings

;; Line number with separator
(global-linum-mode t)
(setq linum-format "%4d \u2502 ")

;; whitespace and column width
(use-package whitespace
  :ensure t
  :config
  (require 'whitespace)
  (setq whitespace-line-column 80) ;; limit line length
  (setq whitespace-style '(face lines-tail tab-mark tabs trailing))
  (setq whitespace-display-mappings
        ;; all numbers are Unicode codepoint in decimal. ⁖ (insert-char 182 1)
        '(
          (newline-mark 10 [182 10]) ; 10 LINE FEED
          (tab-mark 9 [9] [9]) ; 9 TAB, 9655 WHITE RIGHT-POINTING TRIANGLE 「▷」
          ))
  (custom-set-faces
   '(whitespace-trailing ((t (:background "color-88"))))
   '(whitespace-space ((t (:background nil))))
   '(whitespace-tab ((t (:background "color-58" :foreground nil))))
   '(whitespace-line ((t (:background "color-131" :foreground nil))))
   )
  (global-whitespace-mode))

;; Answer with y and n instead of yes and no
(fset 'yes-or-no-p 'y-or-n-p)

;; Always reload the file if it changed on disk
(global-auto-revert-mode 1)

;; Prefer UTF-8 encoding
(prefer-coding-system 'utf-8)

;; Disable toolbar and menubar
(tool-bar-mode -1)
(menu-bar-mode -1)

;; Show parentheses matching
(show-paren-mode 1)

;; Fix path
(when (memq window-system '(mac ns))
  (exec-path-from-shell-initialize))

;; Better scroll experience
(setq scroll-margin 5
      scroll-preserve-screen-position 1)

;; Always use two spaces to indentation
(setq-default indent-tabs-mode nil)
(setq-default tab-width 2)
(setq-default c-basic-offset 2)
(setq css-indent-offset 2)
(setq js-indent-level 2)
(setq web-mode-markup-indent-offset 2)
(setq web-mode-code-indent-offset 2)
(setq web-mode-css-indent-offset 2)

(use-package fullframe
  :ensure t
  :config
  (require 'fullframe)
  (fullframe magit-status magit-mode-quit-window nil))

;; theme
(use-package zenburn-theme
  :ensure t
  :config
  (load-theme 'zenburn t))

;; git gutter
(use-package git-gutter
  :ensure t
  :config
  (require 'git-gutter))

;; Neotree - almost nerd tree
(use-package neotree
  :ensure t
  :config
  (global-set-key [f8] 'neotree-toggle)
  (setq neo-smart-open t)
  (setq neo-show-hidden-files t)
  (setq sentence-end-double-space 0)
  (setq projectile-switch-project-action 'neotree-projectile-action)
  (define-key neotree-mode-map (kbd "i") #'neotree-enter-horizontal-split)
  (define-key neotree-mode-map (kbd "I") #'neotree-enter-vertical-split)
  (add-hook 'neotree-mode-hook
            (lambda ()
              (define-key evil-normal-state-local-map (kbd "q") 'neotree-hide)
              (define-key evil-normal-state-local-map (kbd "RET") 'neotree-enter))))


;; Globally useful plugins

;; magit git awesomeness
(use-package magit
  :ensure t
  :config
  (global-set-key (kbd "C-x g") 'magit-status))

;; smex fuzzy search for M-x commands
(use-package smex
  :ensure t
  :config
  (require 'smex)
  (smex-initialize)
  (global-set-key (kbd "M-x") 'smex)
  (global-set-key (kbd "M-SPC") 'smex)
  (global-set-key (kbd "M-X") 'smex-major-mode-commands)
  ;; This is your old M-x.
  (global-set-key (kbd "C-c C-c M-x") 'execute-extended-comman))

;; Projectile project management tool
(use-package projectile
  :ensure t
  :config
  (projectile-global-mode)
  (add-hook 'projectile-mode-hook
            (lambda ()
              (define-key evil-normal-state-map (kbd "C-p") 'projectile-find-file)
              (define-key evil-normal-state-map (kbd "C-P") 'projectile-find-file-other-window)))
  ;; if ruby include projectile rails for more awesomeness
  (use-package projectile-rails
    :ensure t
    :config
    (add-hook 'ruby-mode-hook 'projectile-rails-on)
    (setq projectile-rails-add-keywords nil)))

;; Ido interactivelly do things better
(use-package ido
  :ensure t
  :config
  (ido-mode t)
  (ido-mode 1)
  (ido-everywhere 1)
  ;; ido vertical for better presentation and scrolling
  (use-package ido-vertical-mode
    :ensure t
    :config
    (require 'ido-vertical-mode)
    (ido-vertical-mode 1)
    (setq ido-vertical-define-keys 'C-n-and-C-p-only))

  ;; fuzzy search for ido
  (use-package flx-ido
    :ensure t
    :config
    (flx-ido-mode 1)
    (setq ido-enable-flex-matching t)
    (setq ido-use-faces nil)
    (global-set-key (kbd "C-x g") 'magit-status)))

;; dictionary
(use-package dictionary :ensure t)

;; flycheck syntax checker
(use-package flycheck
  :ensure t
  :config
  (global-flycheck-mode)
  ;; navigate errors

  (add-hook 'flycheck-mode-hook
            (lambda ()
              (define-key evil-normal-state-map (kbd "]e") 'flycheck-next-error)
              (define-key evil-normal-state-map (kbd "[e") 'flycheck-previous-error))))

;; evil mode for vim bindings
(use-package evil
  :ensure t
  :config
  (evil-mode 1)
  ;; navigate frames more easily
  (define-key evil-normal-state-map (kbd "C-h") 'evil-window-left)
  (define-key evil-normal-state-map (kbd "C-j") 'evil-window-down)
  (define-key evil-normal-state-map (kbd "C-k") 'evil-window-up)
  (define-key evil-normal-state-map (kbd "C-l") 'evil-window-right)
  (defadvice evil-ex-search-next (after advice-for-evil-ex-search-next activate)
    (evil-scroll-line-to-center (line-number-at-pos)))
  (dolist (mode '(ag-mode
                  flycheck-error-list-mode
                  git-rebase-mode))
    (add-to-list 'evil-emacs-state-modes mode))

  ;; leader key
  (use-package evil-leader
    :ensure t
    :config
    (global-evil-leader-mode))

  ;; surround words/lines
  (use-package evil-surround
    :ensure t
    :config
    (global-evil-surround-mode))

  (use-package evil-indent-textobject
    :ensure t)

  ;; comment lines/ranges
  (use-package evil-commentary
    :ensure t
    :config
    (evil-commentary-mode)))

;; Auto complete
(use-package company
  :ensure t
  :defer t
  :init
  (global-company-mode)
  :config
  (setq company-idle-delay 0.1)
  (setq company-selection-wrap-around t)
  (define-key company-active-map [tab] 'company-complete)
  (define-key company-active-map (kbd "C-n") 'company-select-next)
  (define-key company-active-map (kbd "C-p") 'company-select-previous)
  (setq company-minimum-prefix-length 2)
  (push 'company-robe company-backends))




;; Ruby stuff

(setq ruby-insert-encoding-magic-comment nil)
(add-to-list 'auto-mode-alist '("\\.rb$" . ruby-mode))
(add-to-list 'auto-mode-alist '("\\.rake$" . ruby-mode))
(add-to-list 'auto-mode-alist '("Rakefile$" . ruby-mode))
(add-to-list 'auto-mode-alist '("\\.gemspec$" . ruby-mode))
(add-to-list 'auto-mode-alist '("\\.ru$" . ruby-mode))
(add-to-list 'auto-mode-alist '("Gemfile$" . ruby-mode))

;; fix parens in ruby
(setq ruby-deep-indent-paren nil)

(use-package web-mode
  :ensure t
  :config
  (require 'web-mode)
  (add-to-list 'auto-mode-alist '("\\.erb\\'" . web-mode)))

;; use the right ruby version from RVM
(use-package rvm
  :ensure t
  :config
  ;; activate the current RVM ruby version for interactive stuff
  (add-hook 'ruby-mode-hook 'rvm-activate-corresponding-ruby))

;; Run and navigate rspecs
(use-package rspec-mode
  :ensure t
  :config
  (require 'rspec-mode)
  (setq rspec-use-rake-when-possible nil)
  (setq compilation-scroll-output 'first-error))

;; REPL
(use-package inf-ruby
  :ensure t
  :config
  (add-hook 'ruby-mode-hook 'inf-ruby-minor-mode))

;; jump to file
(use-package robe
  :ensure t
  :config
  (add-hook 'ruby-mode-hook 'robe-mode)
  ;; use rvm version for REPL
  (defadvice inf-ruby-console-auto (before activate-rvm-for-robe activate)
    (rvm-activate-corresponding-ruby)))

;; bundler actions inside emacs
(use-package bundler
  :ensure t
  :config
  (require 'bundler))


;; Haskell Stuff

(use-package haskell-mode
  :ensure t
  :config
  (require 'haskell-mode)
  (eval-after-load 'haskell-mode '(progn
                                    (define-key haskell-mode-map (kbd "C-c C-h") 'inferior-haskell-load-and-run)))
  (use-package flycheck-haskell
    :ensure t
    :config
    (eval-after-load 'flycheck
        '(add-hook 'flycheck-mode-hook #'flycheck-haskell-setup)))
  (use-package hindent
    :ensure t
    :config
    (require 'hindent)
    (add-hook 'haskell-mode-hook #'hindent-mode)))
