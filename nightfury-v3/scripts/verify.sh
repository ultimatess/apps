#!/bin/sh
# NightFury v3 verification loop: build -> syntax -> unit -> mutation -> e2e.
# Usage: sh scripts/verify.sh            (one pass, exit 1 on any failure)
#        sh scripts/verify.sh --loop N   (repeat N passes to shake out flaky timing; default 3)
set -u
cd "$(dirname "$0")/.."

pass() {
  echo "── build ─────────────────────────────"
  node scripts/build.mjs || return 1
  echo "── syntax ────────────────────────────"
  for f in js/*.js scripts/*.mjs tests/*.mjs tests/unit/*.mjs tests/e2e/*.mjs sw.js; do
    node --check "$f" || { echo "syntax error in $f"; return 1; }
  done
  echo "ok"
  echo "── unit ──────────────────────────────"
  node --test tests/unit/*.test.mjs > /tmp/nf3-unit.log 2>&1
  status=$?
  grep -E '^(✖|ℹ (tests|pass|fail))' /tmp/nf3-unit.log
  [ $status -eq 0 ] || { grep -A20 '^✖' /tmp/nf3-unit.log | head -60; return 1; }
  if [ "${SKIP_MUTATION:-0}" != "1" ]; then
    echo "── mutation smoke ────────────────────"
    node scripts/mutation-smoke.mjs || return 1
  fi
  echo "── e2e (headless Chrome) ─────────────"
  node tests/e2e/run.mjs || return 1
}

if [ "${1:-}" = "--loop" ]; then
  n=${2:-3}
  i=1
  while [ $i -le $n ]; do
    echo "════════ verify pass $i/$n ════════"
    pass || { echo "✗ verify failed on pass $i/$n"; exit 1; }
    SKIP_MUTATION=1
    i=$((i + 1))
  done
  echo "✓ $n/$n verify passes green"
else
  pass || { echo "✗ verify failed"; exit 1; }
  echo "✓ verify green"
fi
