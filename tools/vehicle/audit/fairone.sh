#!/bin/bash
# fairone.sh <sha> <frames> <base label or ->  [label]
cd /home/user/workspace/mainb
T=tools/vehicle/fairness.ts; cp /home/user/workspace/auditbr/$T /tmp/fairness.keep.ts; git ls-files --error-unmatch $T >/dev/null 2>&1 || rm -f $T
git checkout -q -f --detach $1 || exit 1
cp /tmp/fairness.keep.ts $T
rm -f out/work/vehicle/studio.lock
L=${4:-$1-$2}
if [ "$3" = "-" ]; then timeout 1500 npx tsx tools/vehicle/fairness.ts --label $L --frames $2 ${FMT:+--formats $FMT} --detail ${DETAIL:-full} --sub ${SUB:-4} --zebra ${ZEBRA:-true}
else timeout 1500 npx tsx tools/vehicle/fairness.ts --label $L --frames $2 ${FMT:+--formats $FMT} --detail ${DETAIL:-full} --sub ${SUB:-4} --zebra ${ZEBRA:-true} --base $3; fi
git checkout -q -- $T 2>/dev/null; cp /tmp/fairness.keep.ts $T
echo ALLDONE
