#!/usr/bin/env python3
"""Build the Floating Bear scene figure crops from the shipped Shepard 1926 plates.

The scene SVG in Math-Multiverse.html mounts these as <image> elements over its own
drawn scenery (water, rain, bank, ripples).  Two things follow from that:

  * The plate paper has to go.  A crop pasted opaque would sit on the scene as a white
    rectangle, so every crop is knocked out to transparency -- alpha is taken from the
    plate's own ink density, and the remaining ink is tinted to the scene's ink colour
    (FB_INK) so plate linework and drawn linework read as one hand.
  * Only tonal moves are allowed.  Black point / white point levels and a LANCZOS
    downscale.  Nothing is redrawn, no stroke is added, no shape is retouched.

Every box below is normalized (x0, y0, x1, y1) against its own source plate and is
reproduced verbatim in art/PROVENANCE-shepard-1926.md.  Re-running this script is the
only supported way to regenerate the crops.

Usage:  python art/tools/fb-scene-crops.py [--check]
        --check reports each output's tonal stats without writing files.
"""
import os
import sys
from PIL import Image
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # -> art/
INK = (0x3a, 0x2b, 0x1c)  # FB_INK, the colour the scene draws its own linework in

# name -> (source plate, normalized crop box, black point, white point, output width)
#
# Black points are set from each crop's own histogram (roughly its 1st percentile) so the
# darkest existing ink lands on true black; white points sit just under the scan's paper
# level so paper noise knocks out clean instead of leaving a grey veil.
CROPS = {
    # Beat-1..3 bank figure: Pooh seated in the rain, front-facing, paw to chin.
    'fb-scene-pooh-bank': ('shepard-1926-p156.png', (0.345, 0.145, 0.725, 0.850), 45, 236, 300),
    # The module's namesake: Pooh astride the honey-jar boat.  The faintest of the four
    # sources (p1 = 31 inside this box), so it takes the hardest black-point lift.
    'fb-scene-pooh-boat': ('shepard-1926-p153-1.png', (0.145, 0.450, 0.855, 0.905), 40, 236, 620),
    # A standby crop of the jar alone riding the flood was built from p152-2 at box
    # (0.380, 0.280, 0.850, 0.750), levels 60/236, in case p153-1 read washed out at the
    # scene's real size. It does not: measured on the 304px stage at 1024x768, the p153-1
    # boat box carries a 0.216 dark-pixel share (luminance < 150), and the p152-2 crop's
    # heavier 0.390 turns out to be over-inked blot rather than legible line. p153-1
    # ships; the standby is not built, so it cannot rot unnoticed in art/.
    # Trunk, door-hole, and the sweeping branch with Owl on it.  Cut at 0.845 rather than
    # the trunk's midriff so the root swell at the base survives; cut at 0.80 across so the
    # branch tip lands where the scene's old drawn branch ended instead of overrunning it.
    'fb-scene-tree': ('shepard-1926-p160-1.png', (0.000, 0.000, 0.800, 0.845), 35, 238, 760),
    # Four single pots cut out of the six-pot row on the branch of p150.  The pots touch,
    # so each box is cut on the shared outline rather than in a gap; each runs a little
    # past the pot's foot into the branch hatching it stands on, which gives the pot a
    # base to read against once it is lifted off the plate.
    'fb-scene-jar-1': ('shepard-1926-p150.png', (0.6170, 0.3880, 0.6830, 0.6120), 45, 236, 110),
    'fb-scene-jar-2': ('shepard-1926-p150.png', (0.7280, 0.4250, 0.7940, 0.6120), 45, 236, 110),
    'fb-scene-jar-3': ('shepard-1926-p150.png', (0.5530, 0.4580, 0.6165, 0.6120), 45, 236, 110),
    'fb-scene-jar-4': ('shepard-1926-p150.png', (0.4880, 0.4400, 0.5560, 0.6120), 45, 236, 110),
}


def levels(arr, black, white):
    """Linear black/white point stretch on an 8-bit luminance array."""
    a = arr.astype(np.float32)
    a = (a - black) * (255.0 / (white - black))
    return np.clip(a, 0, 255).astype(np.uint8)


def build(name, spec, check_only=False):
    src, box, black, white, out_w = spec
    src_path = os.path.join(ROOT, src)
    im = Image.open(src_path).convert('L')
    W, H = im.size
    px = (int(box[0] * W), int(box[1] * H), int(box[2] * W), int(box[3] * H))
    sub = im.crop(px)
    raw = np.asarray(sub, dtype=np.uint8)
    stretched = Image.fromarray(levels(raw, black, white), mode='L')

    w, h = stretched.size
    out_h = max(1, round(out_w * h / w))
    small = stretched.resize((out_w, out_h), Image.LANCZOS)
    lum = np.asarray(small, dtype=np.uint8)

    alpha = (255 - lum).astype(np.uint8)
    rgba = np.zeros((out_h, out_w, 4), dtype=np.uint8)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = INK
    rgba[..., 3] = alpha
    img = Image.fromarray(rgba, mode='RGBA')

    ink_share = float((lum < 140).mean())
    print(f'{name:24s} <- {src:24s} box={box} px={px} '
          f'src={w}x{h} out={out_w}x{out_h} aspect={out_w / out_h:.3f} '
          f'raw_p1={np.percentile(raw, 1):.0f} ink<140={ink_share:.4f} '
          f'true_black={(lum == 0).mean():.4f}')
    if check_only:
        return
    dest = os.path.join(ROOT, name + '.png')
    img.save(dest, optimize=True)
    print(f'{"":24s} -> {dest} ({os.path.getsize(dest)} bytes)')


def main():
    check = '--check' in sys.argv
    for name, spec in CROPS.items():
        build(name, spec, check_only=check)


if __name__ == '__main__':
    main()
