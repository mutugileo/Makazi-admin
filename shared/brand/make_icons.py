"""Draws the Makazi mark (forest "M" on a lime tile) for every platform.

    python3 shared/brand/make_icons.py

One geometry, so the admin favicon, the Android/iOS launcher icons and the
Flutter web icons are the same mark as the brand tile in both apps' UI.
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
LIME = (0xC6, 0xEE, 0x58, 255)       # --color-lime-accent
FOREST = (0x0A, 0x26, 0x1F, 255)     # --color-forest-900

# The "M" on a 100 x 100 grid.
M = [(22, 76), (22, 26), (35, 26), (50, 50), (65, 26), (78, 26), (78, 76),
     (66, 76), (66, 46), (54, 65), (46, 65), (34, 46), (34, 76)]


def tile(size: int, rounded: bool, inset: float = 0.0) -> Image.Image:
    """inset: fraction of padding around the tile (Android legacy icons)."""
    scale = 4  # draw large, then downsample for smooth edges
    big = size * scale
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = int(big * inset)
    box = (pad, pad, big - pad, big - pad)
    side = big - 2 * pad
    if rounded:
        d.rounded_rectangle(box, radius=int(side * 0.24), fill=LIME)
    else:
        d.rectangle(box, fill=LIME)
    d.polygon([(pad + x / 100 * side, pad + y / 100 * side) for x, y in M], fill=FOREST)
    return img.resize((size, size), Image.LANCZOS)


def save(img: Image.Image, path: Path, opaque: bool = False):
    path.parent.mkdir(parents=True, exist_ok=True)
    if opaque:  # iOS rejects icons with transparency
        bg = Image.new('RGB', img.size, LIME[:3])
        bg.paste(img, mask=img.split()[3])
        img = bg
    img.save(path)


# Android launcher (legacy square-with-rounded-corners icons).
for folder, px in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
    save(tile(px, rounded=True, inset=0.06), ROOT / f'android/app/src/main/res/mipmap-{folder}/ic_launcher.png')

# iOS: full-bleed square, the system rounds the corners.
ios = ROOT / 'ios/Runner/Assets.xcassets/AppIcon.appiconset'
for name in [p.name for p in ios.glob('Icon-App-*.png')]:
    base, scale = name[len('Icon-App-'):-len('.png')].split('@')
    px = round(float(base.split('x')[0]) * int(scale[:-1]))
    save(tile(px, rounded=False), ios / name, opaque=True)

# Flutter web.
save(tile(192, rounded=True), ROOT / 'web/icons/Icon-192.png')
save(tile(512, rounded=True), ROOT / 'web/icons/Icon-512.png')
save(tile(192, rounded=False), ROOT / 'web/icons/Icon-maskable-192.png', opaque=True)
save(tile(512, rounded=False), ROOT / 'web/icons/Icon-maskable-512.png', opaque=True)
save(tile(32, rounded=True), ROOT / 'web/favicon.png')

# Admin favicons.
admin = ROOT / 'PropAdmin/public'
tile(64, rounded=True).save(admin / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
save(tile(180, rounded=False), admin / 'apple-touch-icon.png', opaque=True)
points = ' '.join(f'{x},{y}' for x, y in M)
(admin / 'favicon.svg').write_text(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
    '<rect width="100" height="100" rx="24" fill="#C6EE58"/>'
    f'<polygon points="{points}" fill="#0A261F"/></svg>\n'
)
print('Makazi icons written.')
