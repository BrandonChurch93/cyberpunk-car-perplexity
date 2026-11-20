import sys, json
import numpy as np
import cv2

AREAS = {
    'sky left': (.13, .00, .30, .11),
    'sky center': (.33, .00, .50, .12),
    'towers left': (.00, .04, .25, .40),
    'towers center': (.25, .12, .50, .40),
    'billboard': (.545, .03, .705, .31),
    'towers right': (.73, .00, 1.0, .40),
    'parapet left': (.00, .475, .22, .575),
    'parapet right': (.84, .51, 1.0, .575),
    'deck far left': (.00, .59, .23, .67),
    'deck near left': (.00, .70, .30, 1.0),
    'deck near center': (.30, .80, .65, 1.0),
    'deck near right': (.65, .70, 1.0, 1.0),
    'body hood': (.36, .47, .58, .60),
    'body flank': (.66, .44, .80, .62),
}

def load(path, width=1600):
    image = cv2.imread(path, cv2.IMREAD_COLOR)
    if image is None:
        raise SystemExit('cannot read ' + path)
    height = round(width * 9 / 16)
    return cv2.resize(image, (width, height), interpolation=cv2.INTER_AREA).astype(np.float32) / 255

def stats(image, box):
    h, w = image.shape[:2]
    x0, y0, x1, y1 = box
    crop = image[round(y0 * h):round(y1 * h), round(x0 * w):round(x1 * w)]
    bgr = crop.reshape(-1, 3)
    luma = bgr @ np.array([.0722, .7152, .2126], dtype=np.float32)
    chroma = bgr.max(axis=1) - bgr.min(axis=1)
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    detail = float(np.abs(cv2.Laplacian(gray, cv2.CV_32F, ksize=3)).mean())
    edges = float(np.abs(cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)).mean())
    mean = bgr.mean(axis=0)[::-1]
    return {
        'rgb': [round(float(v) * 255) for v in mean],
        'p10': round(float(np.percentile(luma, 10)) * 255),
        'p50': round(float(np.percentile(luma, 50)) * 255),
        'p90': round(float(np.percentile(luma, 90)) * 255),
        'p99': round(float(np.percentile(luma, 99)) * 255),
        'chroma': round(float(chroma.mean()) * 255),
        'detail': round(detail * 255, 1),
        'rows': round(edges * 255, 1),
    }

def main():
    if len(sys.argv) < 3:
        raise SystemExit('usage: python3 tools/match.py <approved> <current> [--json]')
    target, current = load(sys.argv[1]), load(sys.argv[2])
    out = {name: {'target': stats(target, box), 'current': stats(current, box)} for name, box in AREAS.items()}
    if '--json' in sys.argv:
        print(json.dumps(out, indent=1))
        return
    head = f"{'area':17} {'':7} {'rgb':>15} {'p10':>4} {'p50':>4} {'p90':>4} {'p99':>4} {'chroma':>6} {'detail':>6} {'rows':>5}"
    print(head)
    for name, pair in out.items():
        for label in ('target', 'current'):
            s = pair[label]
            print(f"{name if label == 'target' else '':17} {label:7} {str(s['rgb']):>15} {s['p10']:4} {s['p50']:4} {s['p90']:4} {s['p99']:4} {s['chroma']:6} {s['detail']:6} {s['rows']:5}")

main()
