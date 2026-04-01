#!/bin/sh
input=$(cat)

# Muted ANSI 256-color palette (Starship-inspired)
RESET='\033[0m'
DIM='\033[2m'
C_DIR='\033[38;5;150m'       # muted sage green
C_MODEL='\033[38;5;183m'     # muted lavender
C_CTX_OK='\033[38;5;109m'    # muted teal
C_CTX_WARN='\033[38;5;179m'  # muted amber
C_CTX_CRIT='\033[38;5;167m'  # muted rose
C_SEP='\033[38;5;238m'       # very dim grey

SEP="${C_SEP}|${RESET}"

dir=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // empty' | sed "s|$HOME|~|")
model=$(echo "$input" | jq -r '.model.display_name // empty')
remaining=$(echo "$input" | jq -r '.context_window.remaining_percentage // empty')

output="${C_DIR}${dir}${RESET}"

if [ -n "$model" ]; then
  output="${output}  ${SEP}  ${C_MODEL}${model}${RESET}"
fi

if [ -n "$remaining" ]; then
  remaining_int=$(printf '%.0f' "$remaining")
  if [ "$remaining_int" -ge 40 ]; then
    ctx_color="$C_CTX_OK"
  elif [ "$remaining_int" -ge 15 ]; then
    ctx_color="$C_CTX_WARN"
  else
    ctx_color="$C_CTX_CRIT"
  fi
  output="${output}  ${SEP}  ${DIM}ctx${RESET} ${ctx_color}${remaining_int}%${RESET}"
fi

printf '%b' "${output}"
