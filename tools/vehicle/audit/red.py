import sys
from PIL import Image
import numpy as np
F='/home/user/workspace/mainb/out/work/vehicle/fairness/'
labs=sys.argv[1].split(','); view=sys.argv[2]
for bx in sys.argv[3:]:
  x0,y0,x1,y1=map(int,bx.split(','))
  out=[]
  for l in labs:
    r=np.asarray(Image.open(F+l+'/ripple-%s.png'%view).convert('RGB')).astype(int)[y0:y1,x0:x1]
    z=np.asarray(Image.open(F+l+'/zebra-%s.png'%view).convert('L')).astype(int)[y0:y1,x0:x1]
    red=((r[...,0]>170)&(r[...,1]<90)&(r[...,2]<90)).mean()
    org=((r[...,0]>170)&(r[...,1]>=90)&(r[...,1]<170)&(r[...,2]<90)).mean()
    out.append('%s red %.0f%% orange %.0f%%'%(l,red*100,org*100))
  z0=np.asarray(Image.open(F+labs[0]+'/zebra-%s.png'%view).convert('L')).astype(int)[y0:y1,x0:x1]
  z1=np.asarray(Image.open(F+labs[-1]+'/zebra-%s.png'%view).convert('L')).astype(int)[y0:y1,x0:x1]
  print(bx,' | '.join(out),' zebra px changed >24:',int((abs(z1-z0)>24).sum()),'of',z0.size)
