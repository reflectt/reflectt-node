# install.sh v1 validation (staging source path)

Staging source path: `reflectt-node/scripts/install.sh`

## Scope lock
- v1: fresh install only
- Out of scope: bootstrap automation, upgrade/migration, endpoint deploy wiring

## Repro commands

### macOS (host)
```bash
cd reflectt-node

# success (test mode)
REFLECTT_INSTALL_TEST_MODE=1 REFLECTT_INSTALL_ALLOW_EXISTING=1 bash scripts/install.sh

# failure: missing jq
REFLECTT_SIMULATE_MISSING_JQ=1 bash scripts/install.sh

# failure: network/download
REFLECTT_INSTALL_ALLOW_EXISTING=1 REFLECTT_SIMULATE_NETWORK_FAIL=1 bash scripts/install.sh

# failure: existing install detected
bash scripts/install.sh

# failure: partial/interrupted prior run requiring cleanup
mkdir -p "$HOME/.reflectt/openclaw" && echo partial > "$HOME/.reflectt/openclaw/.reflectt-install.partial"
REFLECTT_INSTALL_ALLOW_EXISTING=1 REFLECTT_FORCE_PARTIAL_FAIL=1 bash scripts/install.sh
```

### Ubuntu (docker)
```bash
cd reflectt-node

# success (test mode)
docker run --rm -v "$PWD":/work -w /work ubuntu:24.04 bash -lc '
  export DEBIAN_FRONTEND=noninteractive
  apt-get update >/dev/null
  apt-get install -y bash curl tar jq nodejs npm ca-certificates >/dev/null
  REFLECTT_INSTALL_TEST_MODE=1 REFLECTT_INSTALL_ALLOW_EXISTING=1 bash scripts/install.sh
'

# failure: missing jq
docker run --rm -v "$PWD":/work -w /work ubuntu:24.04 bash -lc '
  export DEBIAN_FRONTEND=noninteractive
  apt-get update >/dev/null
  apt-get install -y bash curl tar nodejs npm ca-certificates >/dev/null
  bash scripts/install.sh
'
```

## Exit-code matrix
- `macos-success`: `0`
- `macos-missing-jq`: `1`
- `macos-network-fail`: `1`
- `macos-existing-install`: `1`
- `macos-partial-fail`: `1`
- `ubuntu-success`: `0`
- `ubuntu-missing-jq`: `1`

## Evidence files
- `macos-success.out/.err/.code`
- `macos-missing-jq.out/.err/.code`
- `macos-network-fail.out/.err/.code`
- `macos-existing-install.out/.err/.code`
- `macos-partial-fail.out/.err/.code`
- `ubuntu-success.out/.err/.code`
- `ubuntu-missing-jq.out/.err/.code`

## Done criteria → evidence mapping
1. Fresh install validated on 2 environments (macOS + Ubuntu)
   - `macos-success.*`, `ubuntu-success.*`
2. Non-zero failures with actionable remediation guidance
   - `macos-missing-jq.err`, `macos-network-fail.err`, `macos-existing-install.err`, `macos-partial-fail.err`, `ubuntu-missing-jq.err`
3. Success output includes version, install location, exact next command
   - `macos-success.out`, `ubuntu-success.out`
4. Partial/rerun behavior safe or explicitly blocked with guidance
   - `macos-partial-fail.out/.err`
5. Acceptance checklist and reproducible commands documented
   - this file (`VALIDATION.md`)
6. v2 boundary explicitly documented (install+bootstrap out of scope)
   - scope lock section in this file
