#!/usr/bin/env bash
set -euo pipefail

TASK_ID="task-1771075581699-ahbf0oa6h"
REPO="reflectt/reflectt-node"
WORKFLOW="idle-nudge-regression.yml"
REQUIRED_CHECK="task-linkify-regression-gate"
MUTATION="false"

if [[ "${1:-}" == "--help" ]]; then
  echo "Usage: $0"
  exit 0
fi

if [[ $# -gt 0 ]]; then
  echo "ERROR: no runtime args allowed (mutation paths disabled)." >&2
  exit 1
fi

# Hard safety assertion
if [[ "$MUTATION" != "false" ]]; then
  echo "ERROR: MUTATION assertion failed (must be false)." >&2
  exit 1
fi

FORBIDDEN_PATTERNS=(" apply" "rollback-restore" "rollback-temporary-degraded" "--method PATCH" "--method PUT")
contains_forbidden() {
  local cmd="$1"
  for pat in "${FORBIDDEN_PATTERNS[@]}"; do
    if [[ "$cmd" == *"$pat"* ]]; then
      return 0
    fi
  done
  return 1
}

TS_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
TS_FILE=$(date -u +%Y%m%dT%H%M%SZ)
OUT_DIR="artifacts/task-linkify"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
mkdir -p "$OUT_DIR"
OUT_FILE="$OUT_DIR/TASK-${TASK_ID}-SMOKE-${TS_FILE}.json"

log_step() {
  local step="$1"
  local expected="$2"
  local cmd="$3"

  if contains_forbidden "$cmd"; then
    echo "ERROR: mutating path detected in step '$step'. Aborting no-change run." >&2
    exit 1
  fi

  local out_file="$TMP_DIR/${step}.out"
  local status="PASS"
  local note=""
  if ! eval "$cmd" >"$out_file" 2>&1; then
    status="FAIL"
    note="command_failed"
  fi

  python3 - <<PY > "$TMP_DIR/${step}.json"
import json
from pathlib import Path
out = Path("$out_file").read_text(errors='replace')
excerpt = "\n".join(out.splitlines()[:6])
print(json.dumps({
  "step": "$step",
  "expected": "$expected",
  "actual": excerpt,
  "status": "$status",
  "note": "$note"
}))
PY
}

log_step "auth" "authenticated gh session" "gh auth status"
log_step "repo_target" "repo is $REPO and default branch main" "gh repo view $REPO --json nameWithOwner,defaultBranchRef,url"
log_step "branch_protection_read" "read outputs strict/contexts/required-check presence" "./tools/task-linkify-branch-protection-playbook.sh read"
log_step "latest_run_lookup" "latest workflow run available" "gh run list --repo $REPO --workflow $WORKFLOW --limit 1 --json databaseId,url,event,status,conclusion,createdAt"

RUN_ID=$(python3 - <<PY
import json
from pathlib import Path
raw=Path("$TMP_DIR/latest_run_lookup.out").read_text(errors='replace').strip()
try:
    arr=json.loads(raw)
    print(arr[0].get('databaseId','') if arr else '')
except Exception:
    print('')
PY
)

if [[ -n "$RUN_ID" ]]; then
  log_step "artifact_lookup" "artifact task-linkify-regression-output exists and is valid" "gh api repos/$REPO/actions/runs/$RUN_ID/artifacts"
else
  python3 - <<PY > "$TMP_DIR/artifact_lookup.json"
import json
print(json.dumps({
  "step": "artifact_lookup",
  "expected": "artifact task-linkify-regression-output exists and is valid",
  "actual": "missing run id from latest_run_lookup",
  "status": "FAIL",
  "note": "run_id_not_found"
}))
PY
  echo '{"error":"missing_run_id"}' > "$TMP_DIR/artifact_lookup.out"
fi

python3 - <<PY > "$OUT_FILE"
import json
from pathlib import Path
steps=[]
for name in ["auth","repo_target","branch_protection_read","latest_run_lookup","artifact_lookup"]:
    steps.append(json.loads(Path(f"$TMP_DIR/{name}.json").read_text()))

read_out=Path("$TMP_DIR/branch_protection_read.out").read_text(errors='replace')
has_required = "has_required_context=True" in read_out

artifact_raw = Path("$TMP_DIR/artifact_lookup.out").read_text(errors='replace').strip()
artifact_ok=False
artifact_name=""
artifact_size=0
artifact_non_expired=False
artifact_run_match=False
try:
    obj=json.loads(artifact_raw)
    for a in obj.get("artifacts",[]):
        if a.get("name")=="task-linkify-regression-output":
            artifact_name=a.get("name")
            artifact_size=int(a.get("size_in_bytes",0) or 0)
            artifact_non_expired=not bool(a.get("expired",True))
            artifact_run_match=(str(a.get("workflow_run",{}).get("id",""))==str("$RUN_ID"))
            artifact_ok=artifact_non_expired and artifact_size>0 and artifact_run_match
            break
except Exception:
    pass

blocking=[s["step"] for s in steps if s["status"]!="PASS"]
if not artifact_ok:
    blocking.append("artifact_integrity")
if not has_required:
    # expected in pre-promotion mode; do not block on this alone
    pass

obj={
  "task_id":"$TASK_ID",
  "timestamp_utc":"$TS_UTC",
  "mutation": False,
  "required_check_contract":"$REQUIRED_CHECK",
  "repo":"$REPO",
  "workflow":"$WORKFLOW",
  "run_id":"$RUN_ID",
  "schema":["step","expected","actual","status","note"],
  "steps":steps,
  "has_required_check_in_read":has_required,
  "artifact":{
    "name":artifact_name,
    "non_expired":artifact_non_expired,
    "size_bytes":artifact_size,
    "run_id_match":artifact_run_match,
    "ok":artifact_ok
  },
  "blocking_failures":blocking,
  "decision":"HOLD" if blocking else "GO"
}
print(json.dumps(obj, indent=2))
PY

echo "SMOKE_ARTIFACT=$OUT_FILE"
