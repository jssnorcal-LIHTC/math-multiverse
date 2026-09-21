# Measure Times New Roman Regular advance widths straight from the font, in em units, and write the
# committed table build/tnr-advances.json that build/figure-tokens.js sizes every generated label by.
#
#   python build/measure-tnr.py              print the statistics only
#   python build/measure-tnr.py --write      also rewrite build/tnr-advances.json
#
# NOT fitted against renders.  The committed art was produced by the estimator this table replaces
# (a flat 0.6 em per character), so fitting against it would be circular, which is why an earlier
# proposal to change the flat constant to 0.44 was withdrawn.  The font is the authority.
#
# Moved into the repo from the 26-0915 art pass's untracked tasks/ folder:  a measurement that
# ships in the build must be reproducible from the build.
import io, json, os, sys
from fontTools.ttLib import TTFont

FONT = r"C:\Windows\Fonts\times.ttf"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tnr-advances.json")

f = TTFont(FONT)
upm = f["head"].unitsPerEm
hmtx = f["hmtx"]
cmap = f.getBestCmap()

# Printable ASCII, plus every non-ASCII character a pack draws or a generator emits:  the curly
# quotes and apostrophe, both dashes, the no-break space, the ellipsis truncateToWidth appends,
# and the typographic signs a math or science label is likely to carry.
chars = [chr(c) for c in range(0x20, 0x7F)]
extra = ["\u2019", "\u2018", "\u201c", "\u201d", "\u2014", "\u2013", "\u00a0", "\u2026",
         "\u00d7", "\u00f7", "\u00b0", "\u2212", "\u00b7", "\u00bd", "\u00bc", "\u00be",
         "\u00e9", "\u00e8", "\u00e1", "\u00ed", "\u00f3", "\u00fa", "\u00f1", "\u00fc", "\u2022"]
adv, missing = {}, []
for ch in chars + extra:
    gid = cmap.get(ord(ch))
    if gid is None:
        missing.append(ch)
        continue
    adv[ch] = round(hmtx[gid][0] / upm, 4)

def stats(pred, label):
    vals = [v for k, v in adv.items() if pred(k)]
    if vals:
        print(f"  {label:12} n={len(vals):3}  min={min(vals):.3f}  mean={sum(vals)/len(vals):.3f}  max={max(vals):.3f}")

print(f"{FONT}  unitsPerEm={upm}  measured={len(adv)}  missing={missing!r}")
stats(lambda c: c.isascii() and c.islower() and c.isalpha(), "lower-case")
stats(lambda c: c.isascii() and c.isupper() and c.isalpha(), "upper-case")
stats(lambda c: c.isdigit() and c.isascii(), "digits")
print(f"  widest glyph in the table: {max(adv.values()):.4f} em ({max(adv, key=adv.get)!r})")

if "--write" in sys.argv:
    # Encoding is explicit:  the platform default here is cp1252, which once wrote the non-ASCII
    # keys as raw high bytes and Node read the file back five characters short.
    with io.open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        json.dump({"font": "Times New Roman Regular (times.ttf)", "unitsPerEm": upm,
                   "advances": dict(sorted(adv.items()))}, fh, indent=1, ensure_ascii=True)
        fh.write("\n")
    with io.open(OUT, encoding="utf-8") as fh:
        back = json.load(fh)["advances"]
    assert back == dict(sorted(adv.items())), "round-trip changed the table"
    print(f"wrote {OUT}  ({len(back)} characters, round-trip verified)")
