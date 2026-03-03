#!/bin/bash
# Claude Code Worktree Configuration
# Add this to your ~/.zshrc or ~/.bashrc

# Base directories
export CLAUDE_WORKTREE_BASE="${HOME}/src/shopify/.claude/worktrees"
export SHOPIFY_MONO_ROOT="${HOME}/src/shopify"

# Aliases for navigation
alias cdw="cd ${CLAUDE_WORKTREE_BASE}"
alias cwl="ls -la ${CLAUDE_WORKTREE_BASE}"
alias cws='cd ${CLAUDE_WORKTREE_BASE}/$(ls ${CLAUDE_WORKTREE_BASE} | fzf)'

# Function: Review a Graphite PR
review-pr() {
    local pr_number=$1
    if [ -z "$pr_number" ]; then
        echo "Usage: review-pr <pr-number>"
        return 1
    fi

    local worktree_name="pr-${pr_number}-review"

    # Start Claude Code in left pane (assuming you'll call this from left pane)
    echo "Starting Claude Code for PR #${pr_number}..."
    echo "Run: claude code --worktree ${worktree_name}"
    echo "Then in Claude: checkout graphite PR ${pr_number}"

    # Instructions for right pane
    echo -e "\nIn right pane:"
    echo "cd ${CLAUDE_WORKTREE_BASE}/${worktree_name} && dev up"
}

# Function: Start new feature work
new-feature() {
    local feature_name=$1
    if [ -z "$feature_name" ]; then
        echo "Usage: new-feature <feature-name>"
        return 1
    fi

    local worktree_name="feature-${feature_name}"

    echo "Starting new feature: ${feature_name}"
    echo "Run: claude code --worktree ${worktree_name}"
    echo "Then in Claude: create worktree from main"
}

# Function: Resume work on existing feature
resume-work() {
    local pattern=$1
    if [ -z "$pattern" ]; then
        echo "Usage: resume-work <feature-pattern>"
        return 1
    fi

    # Find matching worktree
    local worktree=$(find ${CLAUDE_WORKTREE_BASE} -maxdepth 1 -name "*${pattern}*" -type d | head -1)

    if [ -z "$worktree" ]; then
        echo "No worktree found matching: ${pattern}"
        echo "Available worktrees:"
        ls ${CLAUDE_WORKTREE_BASE}
        return 1
    fi

    echo "Found worktree: ${worktree}"
    echo "Run: cd ${worktree} && claude code ."
}

# Function: Clean up old worktrees
cleanup-worktrees() {
    echo "Current worktrees:"
    cd ${SHOPIFY_MONO_ROOT}
    git worktree list

    echo -e "\nOrphaned worktree directories:"
    for dir in ${CLAUDE_WORKTREE_BASE}/*; do
        if [ -d "$dir" ]; then
            if ! git worktree list | grep -q "$dir"; then
                echo "  - $dir (orphaned)"
            fi
        fi
    done

    echo -e "\nTo remove: git worktree remove <path>"
}

# Function: Quick status of all worktrees
worktree-status() {
    echo "Active worktrees and their branches:"
    cd ${SHOPIFY_MONO_ROOT}
    git worktree list | while read -r line; do
        local path=$(echo $line | awk '{print $1}')
        local branch=$(echo $line | awk '{print $3}' | tr -d '[]')

        if [[ $path == *"/.claude/worktrees/"* ]]; then
            local name=$(basename $path)
            echo "  ${name}: ${branch}"

            # Check if there's a running server
            if lsof -i :3000 | grep -q "ruby\|node" && [[ $path == $(pwd) ]]; then
                echo "    └─ Server running here"
            fi
        fi
    done
}

# Function: Switch between worktrees with server management
switch-worktree() {
    local target=$1
    if [ -z "$target" ]; then
        # Interactive selection
        target=$(ls ${CLAUDE_WORKTREE_BASE} | fzf --prompt="Select worktree: ")
        if [ -z "$target" ]; then
            return 1
        fi
    fi

    local target_path="${CLAUDE_WORKTREE_BASE}/${target}"

    # Check if server is running in current directory
    if lsof -i :3000 >/dev/null 2>&1; then
        echo "Server is running. Stopping it first..."
        dev down
    fi

    # Switch to target
    cd ${target_path}
    echo "Switched to: ${target_path}"

    # Show branch info
    echo "Branch: $(git branch --show-current)"

    # Ask if user wants to start server
    echo -n "Start dev server here? (y/n) "
    read -r response
    if [[ "$response" == "y" ]]; then
        dev up
    fi
}

# Graphite + Worktree helpers
gt-in-worktree() {
    local worktree=$1
    shift
    local gt_command=$@

    if [ -z "$worktree" ] || [ -z "$gt_command" ]; then
        echo "Usage: gt-in-worktree <worktree-name> <gt-command>"
        return 1
    fi

    (cd ${CLAUDE_WORKTREE_BASE}/${worktree} && gt ${gt_command})
}

# tmux helper for Claude Code workflow
tmux-claude() {
    local session_name="claude-${1:-work}"

    tmux new-session -d -s ${session_name} -n 'main'

    # Main window: Claude Code (left) | Neovim (right)
    tmux send-keys -t ${session_name}:main "claude code" C-m
    tmux split-window -t ${session_name}:main -h
    tmux send-keys -t ${session_name}:main.1 "nvim ." C-m

    # Second window: Terminal for git/graphite commands
    tmux new-window -t ${session_name} -n 'git'

    # Third window: Server logs
    tmux new-window -t ${session_name} -n 'server'

    # Attach to session
    tmux attach-session -t ${session_name}
}

# Function: Prune worktrees for merged branches
prune-worktrees() {
    local dry_run=false
    local auto_confirm=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --dry-run|-n)
                dry_run=true
                shift
                ;;
            --yes|-y)
                auto_confirm=true
                shift
                ;;
            *)
                echo "Usage: prune-worktrees [--dry-run|-n] [--yes|-y]"
                echo "  --dry-run, -n: Show what would be removed without removing"
                echo "  --yes, -y: Auto-confirm removal (skip prompts)"
                return 1
                ;;
        esac
    done

    cd ${SHOPIFY_MONO_ROOT}

    # Get the default branch (usually main)
    local default_branch=$(git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@')

    echo "Checking worktrees for merged branches..."
    echo ""

    local worktrees_to_remove=()
    local worktree_paths=()

    # Process each worktree
    git worktree list --porcelain | while read -r line; do
        if [[ $line == worktree* ]]; then
            current_path=$(echo $line | awk '{print $2}')
        elif [[ $line == branch* ]]; then
            current_branch=$(echo $line | awk '{print $2}' | sed 's@refs/heads/@@')

            # Skip if it's in the Claude worktrees directory
            if [[ $current_path == *"/.claude/worktrees/"* ]]; then
                # Check if this branch has been merged
                if [[ -n "$current_branch" ]] && [[ "$current_branch" != "$default_branch" ]]; then
                    # Check if branch is merged into the default branch
                    if git merge-base --is-ancestor "$current_branch" "origin/$default_branch" 2>/dev/null; then
                        # Double-check that the branch has been deleted on remote
                        if ! git ls-remote --heads origin "$current_branch" | grep -q .; then
                            worktrees_to_remove+=("$current_branch")
                            worktree_paths+=("$current_path")

                            echo "  ✓ $current_branch (merged and deleted from remote)"
                            echo "    Path: $current_path"
                        fi
                    fi
                fi
            fi
        fi
    done

    # If no worktrees to remove
    if [ ${#worktrees_to_remove[@]} -eq 0 ]; then
        echo "No worktrees found for merged branches."
        return 0
    fi

    echo ""
    echo "Found ${#worktrees_to_remove[@]} worktree(s) to prune."

    if [ "$dry_run" = true ]; then
        echo ""
        echo "Dry run complete. No worktrees were removed."
        return 0
    fi

    # Confirm removal
    if [ "$auto_confirm" = false ]; then
        echo ""
        echo -n "Remove these worktrees? (y/N) "
        read -r response
        if [[ ! "$response" =~ ^[yY]$ ]]; then
            echo "Cancelled."
            return 0
        fi
    fi

    # Remove the worktrees
    echo ""
    for i in "${!worktree_paths[@]}"; do
        local path="${worktree_paths[$i]}"
        local branch="${worktrees_to_remove[$i]}"

        echo "Removing worktree for $branch..."

        # Check if there's a running server in this worktree
        if lsof "$path" >/dev/null 2>&1; then
            echo "  ⚠️  Warning: Processes are using this worktree. Stopping them first..."
            lsof "$path" | awk 'NR>1 {print $2}' | xargs -r kill 2>/dev/null
            sleep 1
        fi

        # Remove the worktree
        if git worktree remove "$path" 2>/dev/null; then
            echo "  ✓ Removed successfully"
        else
            # Force remove if normal remove fails
            echo "  ⚠️  Normal removal failed, forcing..."
            git worktree remove --force "$path"
        fi
    done

    echo ""
    echo "Pruning complete!"

    # Also run git worktree prune to clean up any administrative files
    git worktree prune
}

# Alias for common use
alias pwt='prune-worktrees'

# Show available commands
claude-help() {
    echo "Claude Code Worktree Commands:"
    echo "  review-pr <number>     - Set up worktree for PR review"
    echo "  new-feature <name>     - Start new feature worktree"
    echo "  resume-work <pattern>  - Resume work in existing worktree"
    echo "  switch-worktree [name] - Interactive worktree switching"
    echo "  worktree-status       - Show all worktrees and status"
    echo "  cleanup-worktrees     - Find orphaned worktrees"
    echo "  prune-worktrees       - Remove worktrees for merged branches"
    echo "  tmux-claude [name]    - Start tmux session for Claude"
    echo ""
    echo "Options for prune-worktrees:"
    echo "  --dry-run, -n         - Show what would be removed"
    echo "  --yes, -y            - Auto-confirm removal"
    echo ""
    echo "Aliases:"
    echo "  cdw - cd to worktrees directory"
    echo "  cwl - list worktrees"
    echo "  cws - cd to worktree (fuzzy find)"
    echo "  pwt - prune worktrees"
}

