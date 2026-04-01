# Migration: Centralize Loom Directory Structure

This migration moves worktrees and project config from `{projectDirectory}/` into `~/.loom/`.

## Before

```
~/.loom/
  config.json                          (app config)

~/Dev/                                 (projectDirectory)
  .loom/config.json                    (project config: order, commands, initialized)
  .worktrees/{projectName}/{branch}/   (git worktrees)
  .archive/                            (archived projects)
  project-a/                           (git repos)
  project-b/
```

## After

```
~/.loom/
  config.json                          (app config — unchanged)
  project-config.json                  (project config — moved)
  scratch/                             (new: scratch tasks)
  agents/                              (new: agent workspaces)
  skills/                              (new: skill workspaces)
  worktrees/
    projects/{projectName}/{branch}/   (moved from ~/Dev/.worktrees/)
    scratch/
    agents/
    skills/

~/Dev/                                 (projectDirectory — unchanged)
  .archive/                            (unchanged)
  project-a/
  project-b/
```

## Steps

### 1. Create new directory structure

```bash
mkdir -p ~/.loom/{scratch,agents,skills}
mkdir -p ~/.loom/worktrees/{projects,scratch,agents,skills}
```

### 2. Move project config

```bash
PROJ_DIR=$(cat ~/.loom/config.json | python3 -c "import sys,json; print(json.load(sys.stdin).get('projectDirectory','$HOME/Dev'))")

if [ -f "$PROJ_DIR/.loom/config.json" ]; then
  cp "$PROJ_DIR/.loom/config.json" ~/.loom/project-config.json
  echo "Moved project config to ~/.loom/project-config.json"
fi
```

### 3. Move worktrees

Git worktrees store absolute paths in their `.git` file (a text file pointing back to the parent repo's `.git/worktrees/` directory). The parent repo also stores the worktree's absolute path in `.git/worktrees/{name}/gitdir`. Moving worktrees requires updating these references.

```bash
PROJ_DIR=$(cat ~/.loom/config.json | python3 -c "import sys,json; print(json.load(sys.stdin).get('projectDirectory','$HOME/Dev'))")

if [ -d "$PROJ_DIR/.worktrees" ]; then
  for project_dir in "$PROJ_DIR/.worktrees"/*/; do
    [ -d "$project_dir" ] || continue
    project_name=$(basename "$project_dir")
    dest="$HOME/.loom/worktrees/projects/$project_name"

    echo "Moving worktrees for $project_name..."
    mv "$project_dir" "$dest"

    # Fix git worktree references
    for branch_dir in "$dest"/*/; do
      [ -d "$branch_dir" ] || continue
      branch_name=$(basename "$branch_dir")
      git_file="$branch_dir/.git"

      if [ -f "$git_file" ]; then
        # The .git file in the worktree points to the parent's .git/worktrees/{name}
        # Read the current gitdir path
        old_gitdir=$(cat "$git_file" | sed 's/^gitdir: //')

        # Update the parent repo's reference to this worktree
        gitdir_file="$old_gitdir/gitdir"
        if [ -f "$gitdir_file" ]; then
          echo "$branch_dir" > "$gitdir_file"
          echo "  Fixed parent ref for $branch_name"
        fi
      fi
    done
  done

  # Clean up old directory if empty
  rmdir "$PROJ_DIR/.worktrees" 2>/dev/null && echo "Removed empty .worktrees directory" || echo "Note: $PROJ_DIR/.worktrees still has contents"
fi
```

### 4. Verify

```bash
# Check new structure exists
ls -la ~/.loom/worktrees/projects/

# Check project config
cat ~/.loom/project-config.json

# Run git worktree list in each project to verify worktrees are valid
PROJ_DIR=$(cat ~/.loom/config.json | python3 -c "import sys,json; print(json.load(sys.stdin).get('projectDirectory','$HOME/Dev'))")
for d in "$PROJ_DIR"/*/; do
  [ -d "$d/.git" ] || continue
  echo "=== $(basename $d) ==="
  cd "$d" && git worktree list
done

# Start Loom and verify all projects + worktrees load correctly
npm run dev
```

### 5. Clean up old files (after verifying)

```bash
PROJ_DIR=$(cat ~/.loom/config.json | python3 -c "import sys,json; print(json.load(sys.stdin).get('projectDirectory','$HOME/Dev'))")

# Remove old project config directory (only if empty or just has config.json)
rm -f "$PROJ_DIR/.loom/config.json"
rmdir "$PROJ_DIR/.loom" 2>/dev/null

# Remove old worktrees directory (should already be empty from step 3)
rmdir "$PROJ_DIR/.worktrees" 2>/dev/null
```

## Rollback

If something goes wrong:

1. Move worktrees back: `mv ~/.loom/worktrees/projects/* $PROJ_DIR/.worktrees/`
2. Copy config back: `cp ~/.loom/project-config.json $PROJ_DIR/.loom/config.json`
3. Re-run the git worktree path fix (step 3 above) with reversed paths
4. Delete the new directories: `rm -rf ~/.loom/{scratch,agents,skills,worktrees}`
