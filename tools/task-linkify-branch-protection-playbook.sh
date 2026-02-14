#!/usr/bin/env bash
set -euo pipefail

REPO="${REPO:-reflectt/reflectt-node}"
BRANCH="${BRANCH:-main}"
REQUIRED_CONTEXT="${REQUIRED_CONTEXT:-task-linkify-regression-gate}"
MODE="${1:-read}"
BACKUP_FILE="${2:-}"

require_bin() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required binary: $1" >&2; exit 1; }
}

require_bin gh
require_bin python3

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
PROTECTION_JSON="$WORKDIR/protection.json"

fetch_protection() {
  local err_file="$WORKDIR/protection.err"
  if gh api "repos/$REPO/branches/$BRANCH/protection" > "$PROTECTION_JSON" 2>"$err_file"; then
    return 0
  fi

  if grep -q "Branch not protected" "$err_file"; then
    cat > "$PROTECTION_JSON" <<'JSON'
{"required_status_checks":{"strict":false,"checks":[]},"_note":"branch_not_protected"}
JSON
    return 0
  fi

  cat "$err_file" >&2
  return 1
}

read_current_state() {
  python3 - "$PROTECTION_JSON" "$REQUIRED_CONTEXT" <<'PY'
import json,sys
p=sys.argv[1]
required=sys.argv[2]
obj=json.load(open(p))
strict=(obj.get('required_status_checks') or {}).get('strict')
checks=(obj.get('required_status_checks') or {}).get('checks') or []
contexts=[c.get('context') for c in checks if isinstance(c,dict) and c.get('context')]
print(f"strict={strict}")
print("contexts=")
for c in contexts:
    print(f"  - {c}")
print(f"has_required_context={required in contexts}")
PY
}

compute_merged_contexts() {
  python3 - "$PROTECTION_JSON" "$REQUIRED_CONTEXT" <<'PY'
import json,sys
p=sys.argv[1]
required=sys.argv[2]
obj=json.load(open(p))
checks=(obj.get('required_status_checks') or {}).get('checks') or []
contexts=[]
seen=set()
for c in checks:
    ctx=c.get('context') if isinstance(c,dict) else None
    if ctx and ctx not in seen:
        contexts.append(ctx)
        seen.add(ctx)
if required not in seen:
    contexts.append(required)
print("\n".join(contexts))
PY
}

apply_patch_with_contexts() {
  local strict_value="$1"
  shift
  local contexts=("$@")
  local cmd=(gh api --method PATCH "repos/$REPO/branches/$BRANCH/protection/required_status_checks" -f "strict=${strict_value}")
  for ctx in "${contexts[@]}"; do
    cmd+=( -f "contexts[]=${ctx}" )
  done
  "${cmd[@]}" >/dev/null
}

case "$MODE" in
  read)
    fetch_protection
    echo "[read] repo=$REPO branch=$BRANCH required_context=$REQUIRED_CONTEXT"
    read_current_state
    echo "[read] merged_context_set_preview="
    compute_merged_contexts | sed 's/^/  - /'
    ;;

  apply)
    fetch_protection
    timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    backup_dir="artifacts/task-linkify"
    mkdir -p "$backup_dir"
    backup_path="$backup_dir/branch-protection-backup-$timestamp.json"
    cp "$PROTECTION_JSON" "$backup_path"

    mapfile -t contexts < <(compute_merged_contexts)

    echo "[apply] repo=$REPO branch=$BRANCH"
    echo "[apply] backup=$backup_path"
    echo "[apply] strict=true"
    echo "[apply] contexts_to_set=${#contexts[@]}"
    printf '  - %s\n' "${contexts[@]}"

    read -r -p "Type EXACTLY 'CONFIRM_PROTECTION_PATCH' to continue: " ACK
    if [[ "$ACK" != "CONFIRM_PROTECTION_PATCH" ]]; then
      echo "Aborted. No mutation applied."
      exit 1
    fi

    apply_patch_with_contexts "true" "${contexts[@]}"

    fetch_protection
    echo "[apply] verify_after_patch"
    read_current_state
    ;;

  rollback-restore)
    if [[ -z "$BACKUP_FILE" ]]; then
      echo "Usage: $0 rollback-restore <backup-json-path>" >&2
      exit 1
    fi
    if [[ ! -f "$BACKUP_FILE" ]]; then
      echo "Backup file not found: $BACKUP_FILE" >&2
      exit 1
    fi

    echo "[rollback-restore] restoring full branch protection snapshot from: $BACKUP_FILE"
    read -r -p "Type EXACTLY 'CONFIRM_RESTORE_BACKUP' to continue: " ACK
    if [[ "$ACK" != "CONFIRM_RESTORE_BACKUP" ]]; then
      echo "Aborted."
      exit 1
    fi

    gh api --method PUT "repos/$REPO/branches/$BRANCH/protection" --input "$BACKUP_FILE" >/dev/null
    fetch_protection
    echo "[rollback-restore] verify_after_restore"
    read_current_state
    ;;

  rollback-temporary-degraded)
    # Explicitly temporary emergency mode; use only to unblock merges short-term.
    fetch_protection
    mapfile -t existing_contexts < <(python3 - "$PROTECTION_JSON" "$REQUIRED_CONTEXT" <<'PY'
import json,sys
p=sys.argv[1]
required=sys.argv[2]
obj=json.load(open(p))
checks=(obj.get('required_status_checks') or {}).get('checks') or []
out=[]
seen=set()
for c in checks:
    ctx=c.get('context') if isinstance(c,dict) else None
    if not ctx or ctx==required or ctx in seen:
        continue
    out.append(ctx)
    seen.add(ctx)
print("\n".join(out))
PY
)

    echo "[rollback-temporary-degraded] WARNING: temporary degraded mode"
    echo "[rollback-temporary-degraded] this removes $REQUIRED_CONTEXT from required checks and sets strict=false"
    echo "[rollback-temporary-degraded] restore from backup ASAP after incident resolution"
    printf '  - keeping context: %s\n' "${existing_contexts[@]:-<none>}"

    read -r -p "Type EXACTLY 'CONFIRM_TEMP_DEGRADED_MODE' to continue: " ACK
    if [[ "$ACK" != "CONFIRM_TEMP_DEGRADED_MODE" ]]; then
      echo "Aborted."
      exit 1
    fi

    apply_patch_with_contexts "false" "${existing_contexts[@]}"
    fetch_protection
    echo "[rollback-temporary-degraded] verify_after_patch"
    read_current_state
    ;;

  *)
    echo "Usage: $0 {read|apply|rollback-restore <backup-json>|rollback-temporary-degraded}" >&2
    exit 1
    ;;
esac
