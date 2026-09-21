"""Cut assets/cashbook logo.jpeg into the animatable layers the splash needs.

    python mobile/scripts/extract_brand_layers.py

Writes eight PNGs into mobile/assets/brand/ - mark, cash, wordmark, tagline,
each in a normal and an `-on-black` variant. Re-run it if the logo is ever
replaced; nothing else reads the JPEG except the app icon.

WHY THIS EXISTS
---------------
The splash animates four things in sequence, and the source is one flat JPEG
on a solid white background. Neither property survives contact with a black
splash screen:

  * JPEG has no alpha, so the logo arrives as a white square.
  * The four things the animation moves separately are the same pixels.

HOW THE BACKGROUND COMES OFF
----------------------------
By flood-filling white inward from the border, NOT by keying every white
pixel. The wallet's clasp and its ring are drawn in white; keying all white
punches holes straight through the mark. Only white that is reachable from
outside is background.

HOW THE LAYERS ARE FOUND
------------------------
Connected components over what is left. The cash notes turn out to be separate
components from the wallet - which is the fact that makes the spring in phase
2 possible - and the wordmark and tagline separate by vertical position. Small
components inside the mark's own bounding box (the clasp, its ring) are folded
back into the mark rather than treated as their own layer.

TWO THINGS THAT LOOK LIKE DETAILS AND ARE NOT
---------------------------------------------
  * The median filter runs BEFORE thresholding. The source is a JPEG and its
    8x8 blocking shows up as light streaks through flat colour once the white
    behind it is gone.

  * The erosion runs ONCE over the whole silhouette, not per layer. Eroding
    each layer separately eats the boundary between the wallet and its clasp
    and leaves a black ring between them.

THE `-on-black` VARIANTS
------------------------
The same pixels with dark values raised and hue preserved. The brand's Deep
Blue is #012D74, which is 1.63:1 on #000000 - below even the 3:1 floor for
large graphics. Lifting value rather than substituting a different blue keeps
it recognisably the brand's colour.
"""

import os
import sys
from collections import deque

try:
    import numpy as np
    from PIL import Image, ImageFilter
except ImportError:  # pragma: no cover - a dev-time tool, not app code
    sys.exit("Needs Pillow and numpy: pip install pillow numpy")

HERE = os.path.dirname(os.path.abspath(__file__))
MOBILE = os.path.dirname(HERE)
SOURCE = os.path.join(MOBILE, "assets", "cashbook logo.jpeg")
OUT_DIR = os.path.join(MOBILE, "assets", "brand")

#: Sum of RGB above which a pixel counts as background white. Tight enough
#: that the compression halo around the mark is background too.
WHITE_SUM = 660
#: Components smaller than this are JPEG speckle, not artwork.
MIN_COMPONENT = 60
#: Slack when testing whether a component sits inside the mark's bounding box.
#: The clasp overhangs it by a pixel of antialiasing.
BBOX_PAD = 8
#: Components centred above this row are the cash; below it, the wordmark.
CASH_BELOW = 420
#: Components centred below this row are the tagline.
TAGLINE_BELOW = 945


def background_mask(rgb: "np.ndarray") -> "np.ndarray":
    """White reachable from the border. Interior white is NOT background."""
    h, w, _ = rgb.shape
    near_white = rgb.sum(axis=2) > WHITE_SUM
    seen = np.zeros((h, w), bool)
    queue: deque = deque()

    def push(y: int, x: int) -> None:
        if near_white[y, x] and not seen[y, x]:
            seen[y, x] = True
            queue.append((y, x))

    for x in range(w):
        push(0, x)
        push(h - 1, x)
    for y in range(h):
        push(y, 0)
        push(y, w - 1)

    while queue:
        y, x = queue.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w:
                push(ny, nx)
    return seen


def label(foreground: "np.ndarray") -> tuple["np.ndarray", dict]:
    """8-connected components, with each one's pixel count and bounding box."""
    h, w = foreground.shape
    labels = np.zeros((h, w), np.int32)
    info: dict[int, tuple] = {}
    current = 0
    for y in range(h):
        for x in range(w):
            if not foreground[y, x] or labels[y, x]:
                continue
            current += 1
            labels[y, x] = current
            queue = deque([(y, x)])
            xs: list[int] = []
            ys: list[int] = []
            while queue:
                cy, cx = queue.popleft()
                xs.append(cx)
                ys.append(cy)
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = cy + dy, cx + dx
                        if (
                            0 <= ny < h
                            and 0 <= nx < w
                            and foreground[ny, nx]
                            and not labels[ny, nx]
                        ):
                            labels[ny, nx] = current
                            queue.append((ny, nx))
            info[current] = (len(xs), min(xs), max(xs), min(ys), max(ys))
    return labels, info


def main() -> None:
    if not os.path.exists(SOURCE):
        sys.exit(f"No logo at {SOURCE}")
    os.makedirs(OUT_DIR, exist_ok=True)

    # Median first: see the module docstring.
    image = Image.open(SOURCE).convert("RGB").filter(ImageFilter.MedianFilter(3))
    rgb = np.array(image).astype(int)
    height, width, _ = rgb.shape

    foreground = ~background_mask(rgb)

    # One erosion over the whole silhouette, so internal boundaries survive.
    silhouette = np.array(
        Image.fromarray((foreground * 255).astype(np.uint8)).filter(
            ImageFilter.MinFilter(3)
        )
    )

    labels, info = label(foreground)
    mark_id = max(info, key=lambda i: info[i][0])
    _, mx0, mx1, my0, my1 = info[mark_id]

    def layer_of(index: int):
        count, x0, x1, y0, y1 = info[index]
        if count < MIN_COMPONENT:
            return None
        if index == mark_id:
            return "mark"
        inside = (
            x0 >= mx0 - BBOX_PAD
            and x1 <= mx1 + BBOX_PAD
            and y0 >= my0 - BBOX_PAD
            and y1 <= my1 + BBOX_PAD
        )
        if inside:
            return "mark"
        centre = (y0 + y1) / 2
        if centre < CASH_BELOW:
            return "cash"
        if centre < TAGLINE_BELOW:
            return "wordmark"
        return "tagline"

    groups: dict[str, list[int]] = {}
    for index in info:
        name = layer_of(index)
        if name:
            groups.setdefault(name, []).append(index)

    source_px = np.array(image).astype(np.uint8)
    geometry: dict[str, tuple] = {}

    def export(name: str, ids: list[int], lift: bool) -> None:
        member = np.isin(labels, ids)
        alpha = np.where(member, silhouette, 0).astype(np.uint8)
        ys, xs = np.nonzero(alpha > 0)
        x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()

        rgba = np.zeros((height, width, 4), np.uint8)
        rgba[..., :3] = source_px
        rgba[..., 3] = alpha

        if lift:
            px = rgba[..., :3].astype(float)
            value = px.max(axis=2) / 255.0
            dark = (alpha > 0) & (value < 0.62) & (value > 0)
            scale = np.where(dark, np.minimum(0.86 / np.maximum(value, 1e-6), 3.2), 1.0)
            rgba[..., :3] = np.clip(px * scale[..., None], 0, 255).astype(np.uint8)

        Image.fromarray(rgba[y0 : y1 + 1, x0 : x1 + 1], "RGBA").save(
            os.path.join(OUT_DIR, f"{name}.png")
        )
        geometry[name] = (int(x0), int(x1), int(y0), int(y1))

    for layer in ("mark", "cash", "wordmark", "tagline"):
        ids = groups.get(layer)
        if not ids:
            sys.exit(f"No components landed in the {layer!r} layer - check the source")
        export(layer, ids, lift=False)
        export(f"{layer}-on-black", ids, lift=True)
        x0, x1, y0, y1 = geometry[layer]
        print(f"  {layer:9} {x1 - x0 + 1:4} x {y1 - y0 + 1:4}   ({len(ids)} components)")

    mark_box = geometry["mark"]
    cash_box = geometry["cash"]
    print(
        "\nCASH_DX / CASH_DY in brand-mark.tsx must be "
        f"{cash_box[0] - mark_box[0]} / {cash_box[2] - mark_box[2]}"
    )


if __name__ == "__main__":
    main()
