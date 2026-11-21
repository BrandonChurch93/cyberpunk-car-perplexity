import sys,re
def load(p):
  d={}
  for l in open(p):
    m=re.match(r'^(\S+)\s+(.+?)\s{2,}(\d+)\s+(.*)$',l.rstrip())
    if m: d[(m.group(1),m.group(2).strip())]=[m.group(3)]+m.group(4).split()
  return d
a=load(sys.argv[1]);b=load(sys.argv[2])
print('view panel | samples crease% p95  ->  samples left-out% p95')
for k in sorted(a):
  if k in b: print('%-13s %-18s | %6s %3s%% %5s -> %6s %3s%% %5s'%(k[0],k[1],a[k][0],a[k][1],a[k][5],b[k][0],b[k][1],b[k][5]))
