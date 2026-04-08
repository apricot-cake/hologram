"""Generate Eagle Info+ icons.

lenso.ai-inspired abstract mark: two rounded geometric primitives
(a tilted pill + a rounded plus) composed as a symbol rather than a letterform.
"""
from PIL import Image, ImageDraw
import os

SIZES = [16, 32, 48, 128]
COLOR = (37, 99, 235)  # #2563eb
SS = 4
OUT_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "icons"))


def tilted_pill_mask(canvas_size, cx, cy, length, thickness, angle_deg):
    """Return an L mask with a pill (fully rounded rect) rotated around (cx, cy)."""
    # Draw in an oversized local buffer, rotate, then paste.
    pad = int(max(length, thickness)) + 4
    bw, bh = pad * 2, pad * 2
    buf = Image.new("L", (bw, bh), 0)
    d = ImageDraw.Draw(buf)
    x0 = (bw - length) / 2
    y0 = (bh - thickness) / 2
    d.rounded_rectangle(
        (x0, y0, x0 + length, y0 + thickness),
        radius=thickness / 2,
        fill=255,
    )
    rot = buf.rotate(angle_deg, resample=Image.BICUBIC, expand=True)
    mask = Image.new("L", (canvas_size, canvas_size), 0)
    rw, rh = rot.size
    mask.paste(rot, (int(cx - rw / 2), int(cy - rh / 2)), rot)
    return mask


def rounded_plus_mask(canvas_size, cx, cy, arm, thickness):
    """Return an L mask with a plus whose arms are pills."""
    mask = Image.new("L", (canvas_size, canvas_size), 0)
    d = ImageDraw.Draw(mask)
    r = thickness / 2
    # horizontal arm
    d.rounded_rectangle(
        (cx - arm, cy - thickness / 2, cx + arm, cy + thickness / 2),
        radius=r,
        fill=255,
    )
    # vertical arm
    d.rounded_rectangle(
        (cx - thickness / 2, cy - arm, cx + thickness / 2, cy + arm),
        radius=r,
        fill=255,
    )
    return mask


def build_mark(S):
    """Compose the E+ abstract mark within an S×S canvas as an L mask."""
    mask = Image.new("L", (S, S), 0)

    # Left element: tall tilted pill (evokes the spine of "E" / lenso's left mark)
    pill_len = int(S * 0.78)
    pill_thick = int(S * 0.22)
    pill_cx = int(S * 0.34)
    pill_cy = int(S * 0.50)
    pill = tilted_pill_mask(S, pill_cx, pill_cy, pill_len, pill_thick, angle_deg=75)
    mask.paste(pill, (0, 0), pill)

    # Right element: rounded plus
    plus_arm = int(S * 0.24)
    plus_thick = int(S * 0.22)
    plus_cx = int(S * 0.72)
    plus_cy = int(S * 0.58)
    plus = rounded_plus_mask(S, plus_cx, plus_cy, plus_arm, plus_thick)
    mask.paste(plus, (0, 0), plus)

    return mask


def render(size):
    S = size * SS
    mask = build_mark(S)
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(COLOR, (0, 0), mask)
    return out.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for s in SIZES:
        img = render(s)
        path = os.path.join(OUT_DIR, f"icon{s}.png")
        img.save(path)
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
