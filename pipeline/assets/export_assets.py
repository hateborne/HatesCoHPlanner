"""Write icons, UI chrome and fonts into public/assets/ and return a coverage summary.

Layout:
  public/assets/icons/{powers,enh,at,origin}/<lower name>.png
  public/assets/ui/<lower texture path under gui/>.png   (backgrounds as .webp)
  public/assets/fonts/<file>.ttf          (copied from pipeline/inputs/fonts)
  public/assets/manifest.json   {icon kind: [names...], ui: [paths...], fonts: [...]}
"""
from __future__ import annotations

import json
import zlib

from pipeline import config
from pipeline.assets.textures import TextureIndex, decode

UI_PREFIXES = ("gui/creation/common/", "gui/creation/enhancements/", "gui/creation/powers/",
               "gui/hud/tray/tray_ring", "gui/hud/common/scroll_bar/", "gui/hud/map/map_zoom_",
               "gui/hud/common/select_buttons/genericbutton_", "gui/hud/common/frame/frame_flat_3px/",
               "gui/hud/common/frame/frame_gen_backgrounds_3px/frame_3px_10r_background_")
FONT_FILES = ["REDCIRCL.ttf", "Paragon City Italic.ttf", "mont_demibold.TTF", "mont_hvbold.TTF"]
FONT_DIR = config.FONTS_DIR  # vendored in the repo (pipeline/inputs/fonts); these never change
# Front-end sounds the level-up screens play (sndPlay in uiLevelPower.c / uiLevelSpec.c /
# uiPowers.c / uiCombineSpec.c).
SOUNDS = ["powerselect2", "next", "back", "reject5", "select5", "grab4", "delete", "tally", "changescreen"]
# Every sound under N_UI/ (the character creator's set: UI/Hybrid/*.c, uiCostume.c, uiGender.c --
# N_Select, N_MouseEnter, N_Archetype_<class>, N_Origin_<origin>, N_Playstyle_*, ...) plus the login
# music. The Homecoming client picks the menu track by UI skin: H_ (hero), V_ (villain), else N_.
SOUND_DIRS = ("sound/ogg/n_ui/",)
MUSIC = ["h_menumusic_loop", "v_menumusic_loop", "n_menumusic_loop"]
SOUND_LOOSE = config.OURO_DATA / "bin" / "data" / "sound" if config.OURO_DATA else None


class SoundIndex:
    """Every .ogg the client can play, by lower-cased bare name and by path.

    Later sources override earlier ones, as the client's pigg layering does: OuroV2 loose files
    (only when COH_SOURCE is set), then the Homecoming issue24 piggs, then the live overlay piggs.
    """

    def __init__(self):
        from pipeline.coh import p7reader  # noqa: F401  (puts the repo tools/ folder on sys.path)
        import pigg_extract as pex

        self.by_name: dict[str, tuple[str, object]] = {}
        if SOUND_LOOSE is not None and SOUND_LOOSE.exists():  # optional (COH_SOURCE)
            for f in SOUND_LOOSE.rglob("*.ogg"):
                rel = "sound/" + f.relative_to(SOUND_LOOSE).as_posix().lower()
                self.by_name[f.stem.lower()] = (rel, f)
        for pg in sorted(config.I24_ASSETS.glob("*.pigg")) + sorted(config.LIVE_ASSETS.glob("*.pigg")):
            with open(pg, "rb") as fh:
                for e in pex.read_directory(fh):
                    path = e["path"].replace("\\", "/").lower()
                    if path.startswith("sound/") and path.endswith(".ogg"):
                        self.by_name[path.rsplit("/", 1)[-1][:-4]] = (path, (pg, e))

    def read(self, name: str) -> bytes | None:
        """@return The .ogg bytes for a bare sound name, or None if no source has it."""
        hit = self.by_name.get(name.lower())
        if hit is None:
            return None
        src = hit[1]
        if isinstance(src, tuple):
            pg, e = src
            with open(pg, "rb") as f:
                f.seek(e["offset"])
                raw = f.read(e["packSize"] or e["size"])
            return zlib.decompress(raw) if e["packSize"] else raw
        return src.read_bytes()

    def names_under(self, prefixes: tuple[str, ...]) -> list[str]:
        """@return Bare names of every sound whose path starts with one of `prefixes`."""
        return sorted(n for n, (rel, _) in self.by_name.items() if rel.startswith(prefixes))


def export_sounds() -> tuple[list[str], list[str]]:
    """Copy the UI sounds and menu music into public/assets/sounds/<lower name>.ogg.

    @return (exported names, missing names).
    """
    ix = SoundIndex()
    got, miss = [], []
    for name in SOUNDS + ix.names_under(SOUND_DIRS) + MUSIC:
        data = ix.read(name)
        if data is None:
            miss.append(name)
            continue
        config.atomic_write(config.ASSETS_OUT / "sounds" / f"{name.lower()}.ogg", data)
        got.append(name.lower())
    return sorted(set(got)), miss


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


SKIN_TS = config.REPO / "src" / "ui" / "skin" / "skinVariants.ts"


def write_skin_variants(ui_paths: list[str]) -> None:
    """Write the V_/P_ texture list the web app needs to port addAtlasTex's skin lookup.

    The client loads "v_" / "p_" + name for the villain / Praetorian skins whenever that texture
    exists and falls back to the plain name (textureatlas.c addAtlasTex), so the app has to know
    synchronously which variants exist.

    @param ui_paths Exported UI paths as listed in manifest["ui"] ("ui/<dir>/<file>.<ext>").
    """
    names = []
    for u in ui_paths:
        rel = u[len("ui/"):].rsplit(".", 1)[0]
        if rel.rsplit("/", 1)[-1][:2] in ("v_", "p_"):
            names.append(rel)
    nl = "\n"
    body = "".join(f"  '{n}',{nl}" for n in sorted(names))
    config.atomic_write(SKIN_TS,
        "// Generated by pipeline/assets/export_assets.py -- do not edit." + nl
        + "// UI textures that ship a villain (v_) or Praetorian (p_) variant (see ui() in skin.ts)." + nl
        + f"export const SKIN_VARIANTS: ReadonlySet<string> = new Set([{nl}{body}]);{nl}")


def check_not_smaller(manifest: dict, prev: dict | None) -> None:
    """Fail the run if any asset class has fewer files than the previous manifest listed.

    @param manifest The manifest about to be written.
    @param prev The previous public/assets/manifest.json content (None on a first export).
    @raise SystemExit Naming each class that shrank.
    """
    if not prev:
        return
    short = []
    old = {f"icons/{k}": len(v) for k, v in prev.get("icons", {}).items()}
    new = {f"icons/{k}": len(v) for k, v in manifest["icons"].items()}
    for k in ("ui", "fonts", "sounds"):
        old[k] = len(prev.get(k, []))
        new[k] = len(manifest.get(k, []))
    for k, n in old.items():
        if new.get(k, 0) < n:
            short.append(f"{k}: {new.get(k, 0)} < {n}")
    if short:
        raise SystemExit("error: asset export is smaller than the previous manifest (" + "; ".join(short)
                         + "). Check the client piggs / COH_SOURCE; to accept a real shrink, delete "
                           "public/assets/manifest.json and re-run.")


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
            config.atomic_write(dst, src.read_bytes())
            manifest["fonts"].append(dst.name)
        else:
            missing.setdefault("fonts", []).append(fname)

    manifest["sounds"], miss_sounds = export_sounds()
    if miss_sounds:
        missing["sounds"] = miss_sounds

    mpath = config.ASSETS_OUT / "manifest.json"
    try:
        prev = json.loads(mpath.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        prev = None
    check_not_smaller(manifest, prev)
    config.atomic_write(mpath, json.dumps(manifest, separators=(",", ":")))
    write_skin_variants(manifest["ui"])
    return {"counts": {k: len(v) for k, v in manifest["icons"].items()} | {
        "ui": len(manifest["ui"]), "fonts": len(manifest["fonts"]),
        "sounds": len(manifest["sounds"])}, "missing": missing}
