import sys
from PIL import Image, ImageDraw
F='/home/user/workspace/mainb/out/work/vehicle/fairness/'
def pair(la,lb,k,view,box,sc,step=20):
  ims=[Image.open(F+l+'/%s-%s.png'%(k,view)).convert('RGB').crop(box) for l in [la,lb]]
  w,h=ims[0].size; o=Image.new('RGB',(2*w+4,h),'white')
  for i,m in enumerate(ims): o.paste(m,(i*(w+4),0))
  o=o.resize((o.width*sc,o.height*sc),Image.NEAREST); d=ImageDraw.Draw(o)
  for t in range(2):
    for yy in range(0,h,step): d.text((t*(w+4)*sc+2,yy*sc),str(box[1]+yy),fill=(255,255,0))
    for xx in range(0,w,step*2): d.text(((t*(w+4)+xx)*sc,2),str(box[0]+xx),fill=(255,255,0))
  return o
la,lb,view,out=sys.argv[1:5]; box=tuple(map(int,sys.argv[5].split(','))); sc=int(sys.argv[6])
a=pair(la,lb,'zebra',view,box,sc); b=pair(la,lb,'ripple',view,box,sc)
O=Image.new('RGB',(a.width,a.height*2+6),'white'); O.paste(a,(0,0)); O.paste(b,(0,a.height+6)); O.save(out); print(O.size)
