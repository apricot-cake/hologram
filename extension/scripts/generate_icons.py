"""Generate Eagle Info+ icons: Eagle-blue gradient ring."""
from PIL import Image
import math
import os

SIZES = [16, 32, 48, 128]
SS = 4  # supersampling factor for antialiasing
OUT_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "icons"))

# Eagle-ish blue gradient: deeper blue -> pale blue
COLOR_A = (0, 120, 255)    # #0078FF
COLOR_B = (170, 220, 255)  # #AADCFF


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def draw_ring(S):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    px = img.load()
    cx = cy = S / 2
    outer = S * 0.46
    inner = S * 0.33
    edge = 1.2  # AA softening in supersampled px
    outer_bound_sq = (outer + edge) ** 2
    inner_bound_sq = (inner - edge) ** 2
    for y in range(S):
        dy = y + 0.5 - cy
        for x in range(S):
            dx = x + 0.5 - cx
            d_sq = dx * dx + dy * dy
            if d_sq > outer_bound_sq or d_sq < inner_bound_sq:
                continue
            d = math.sqrt(d_sq)
            a_outer = max(0.0, min(1.0, (outer + edge - d) / (2 * edge)))
            a_inner = max(0.0, min(1.0, (d - inner + edge) / (2 * edge)))
            a = a_outer * a_inner
            if a <= 0:
                continue
            # horizontal gradient: left = COLOR_A, right = COLOR_B
            t = max(0.0, min(1.0, (dx / outer + 1) / 2))
            color = lerp(COLOR_A, COLOR_B, t)
            px[x, y] = (color[0], color[1], color[2], int(255 * a))
    return img


def render(size):
    S = size * SS
    big = draw_ring(S)
    return big.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for s in SIZES:
        img = render(s)
        path = os.path.join(OUT_DIR, f"icon{s}.png")
        img.save(path)
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
