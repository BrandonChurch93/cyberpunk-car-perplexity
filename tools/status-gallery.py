import sys, json, base64, io
from PIL import Image
out = sys.argv[1]; items = []
for spec in sys.argv[2:]:
    path, cap = spec.split('|', 1)
    im = Image.open(path).convert('RGB')
    w = 720
    if im.width > w: im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, 'JPEG', quality=80, optimize=True)
    items.append({'caption': cap, 'w': im.width, 'h': im.height, 'src': 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()})
json.dump({'images': items}, open(out, 'w'))
print(out, round(len(open(out).read()) / 1024), 'KB', [(i['w'], i['h']) for i in items])
