#!/bin/bash
set -euo pipefail
# Run in the already-prepared, detached audit worktree, not the builder's tree.
if [ "$#" -lt 3 ] || [ "$#" -gt 4 ]; then
  echo 'Usage: fairone.sh <sha> <frames> <base label or -> [label]' >&2
  exit 2
fi
cd "$(git rev-parse --show-toplevel)"
if git symbolic-ref --quiet HEAD >/dev/null || [ "$(git rev-parse HEAD)" != "$(git rev-parse "$1^{commit}")" ]; then
  echo 'Check out the requested SHA in a detached audit worktree first' >&2
  exit 2
fi
base=()
if [ "$3" != - ]; then base=(--base "$3"); fi
exec npx tsx tools/vehicle/fairness.ts --label "${4:-$(git rev-parse --short HEAD)-$2}" --frames "$2" \
  --formats "${FMT:-master}" --detail "${DETAIL:-full}" --sub "${SUB:-2}" --zebra "${ZEBRA:-false}" "${base[@]}"
