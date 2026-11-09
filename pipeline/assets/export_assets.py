"""Write icons, UI chrome and fonts into public/assets/ and return a coverage summary.

Layout:
  public/assets/icons/{powers,enh,at,origin}/<lower name>.png
  public/assets/ui/<lower texture path under gui/>.png   (backgrounds as .webp)
  public/assets/fonts/<file>.ttf
  public/assets/manifest.json   {icon kind: [names...], ui: [paths...], fonts: [...]}
"""
from __future__ import annotations

import json
import shutil

from pipeline import config
from pipeline.assets.textures import TextureIndex, decode

UI_PREFIXES = ("gui/creation/common/", "gui/creation/enhancements/", "gui/hud/tray/tray_ring")
FONT_FILES = ["REDCIRCL.ttf", "Paragon City Italic.ttf", "mont_demibold.TTF", "mont_hvbold.TTF"]
FONT_DIR = config.OURO_DATA / "bin" / "data" / "fonts"


def _write(img, rel_out: str, webp: bool = False) -> str:
    out = config.ASSETS_OUT / rel_out
    if webp:
        out = out.with_suffix(".webp")
        config.out_path(out)
        img.save(out, "WEBP", quality=88, method=6)
    else:
        out = out.with_suffix(".png")
        config.out_path(out)
        img.save(out, "PNG", optimize=True)
    return out.relative_to(config.ASSETS_OUT).as_posix()


def run(data_root) -> dict:
    """Export every asset referenced by the exported data in `data_root`."""
    ix = TextureIndex()
    core = json.loads((data_root / "core.json").read_text(encoding="utf-8"))
    powers = json.loads((data_root / "powers.json").read_text(encoding="utf-8"))
    boosts = json.loads((data_root / "boosts.json").read_text(encoding="utf-8"))

    wanted = {
        "powers": ({p["icon"] for p in powers} | {"Power_Missing"}, "gui/icons/powers"),
        "enh": ({b["icon"] for b in boosts["boosts"]}
                | {f for b in boosts["boosts"] for f in b.get("bf", [])}
                | {x["icon"] for x in core["attribNames"]["Boost"]}, "gui/icons/enhancements"),
        "at": ({a["icon"] for a in core["archetypes"]}, "gui/icons/archetype"),
        "origin": ({o["icon"] for o in core["origins"]}, "gui/icons/origin"),
    }
    manifest: dict = {"icons": {}, "ui": [], "fonts": []}
    missing: dict = {}
    for kind, (names, prefer) in wanted.items():
        got, miss = [], []
        for name in sorted(n for n in names if n):
            src = ix.find(name, prefer)
            if src is None:
                miss.append(name)
                continue
            _write(decode(src.read()), f"icons/{kind}/{name.lower()}")
            got.append(name.lower())
        manifest["icons"][kind] = got
        missing[kind] = miss

    for rel, src in sorted(ix.by_rel.items()):
        if not rel.startswith(UI_PREFIXES):
            continue
        img = decode(src.read())
        big = img.width * img.height >= 256 * 256
        manifest["ui"].append(_write(img, f"ui/{rel[len('gui/'):]}", webp=big))

    for fname in FONT_FILES:
        src = FONT_DIR / fname
        if src.exists():
            dst = config.out_path(config.ASSETS_OUT / "fonts" / fname.lower().replace(" ", "_"))
            shutil.copyfile(src, dst)
            manifest["fonts"].append(dst.name)
        else:
            missing.setdefault("fonts", []).append(fname)

    config.out_path(config.ASSETS_OUT / "manifest.json").write_text(
        json.dumps(manifest, separators=(",", ":")), encoding="utf-8")
    return {"counts": {k: len(v) for k, v in manifest["icons"].items()} | {
        "ui": len(manifest["ui"]), "fonts": len(manifest["fonts"])}, "missing": missing}
