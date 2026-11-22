"""Write icons, UI chrome and fonts into public/assets/ and return a coverage summary.

Layout:
  public/assets/icons/{powers,enh,at,origin}/<lower name>.png
  public/assets/ui/<lower texture path under gui/>.png   (backgrounds as .webp)
  public/assets/fonts/<file>.ttf          (copied from pipeline/inputs/fonts)
  public/assets/manifest.json   {icon kind: [names...], ui: [paths...], fonts: [...]}
  public/assets/<server>/icons/<kind>/<lower name>.png   another server's icons (plan_icon_overlay)
  public/assets/<server>/manifest.json   {icons: {kind: [names...]}}

`python -m pipeline.assets.export_assets` adds only the UI textures the lists below name that
public/assets does not have yet (add_missing_ui): for a texture a new screen needs between patches.

The shared assets come from Homecoming's default version. Another server (Thunderspy) keeps its own
copy of every icon it shows: the shared file itself where its art is the same (Git stores identical
files once), its own texture where the art differs or Homecoming lacks it. Its data names them
"<server>:<name>" (the app's icon() resolves the prefix), so a later Homecoming redraw never changes
what the other server shows. The server's own newest version replaces its art for all its versions,
as the shared icons do (write_icon_overlay's add_only keeps it for an older version's run).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import zlib
from pathlib import PurePosixPath

from PIL import Image, ImageChops, ImageStat

from pipeline import config
from pipeline.assets.textures import TextureIndex, decode

UI_PREFIXES = ("gui/creation/common/", "gui/creation/enhancements/", "gui/creation/powers/",
               "gui/hud/tray/tray_ring", "gui/hud/common/scroll_bar/", "gui/hud/map/map_zoom_",
               "gui/hud/common/select_buttons/genericbutton_", "gui/hud/common/frame/frame_flat_3px/",
               "gui/hud/common/frame/frame_gen_backgrounds_3px/frame_3px_10r_background_")
# Single UI textures, matched exactly (a prefix would also take their unused "..a" variants):
# the sparks electric_display (uiFx.c) draws on a newly added enhancement slot, and the invention
# tutorial's badge, the owner's pick for the set finder's button.
UI_FILES = frozenset(f"gui/hud/common/special_effects/enhnc_spark0{i}" for i in (1, 2, 3)) | {
    "gui/icons/badges/badge_invention_tutorial"}
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


class SoundIndex:
    """Every .ogg the client can play, by lower-cased bare name and by path.

    Later sources override earlier ones, as the client's pigg layering does: OuroV2 loose files
    (only when COH_SOURCE is set), then the Homecoming issue24 piggs, then the live overlay piggs.
    """

    def __init__(self):
        from pipeline.coh import p7reader  # noqa: F401  (puts the repo tools/ folder on sys.path)
        import pigg_extract as pex

        self.by_name: dict[str, tuple[str, object]] = {}
        loose = config.OURO_DATA / "bin" / "data" / "sound" if config.OURO_DATA else None
        if loose is not None and loose.exists():  # optional (COH_SOURCE)
            for f in loose.rglob("*.ogg"):
                rel = "sound/" + f.relative_to(loose).as_posix().lower()
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


# an asset's path under public/assets, built from game data names: plain names and folders only
SAFE_ASSET = re.compile(r"[a-z0-9_'][a-z0-9_.\-' ]*(/[a-z0-9_'][a-z0-9_.\-' ]*)*")


def _write(img, rel_out: str, webp: bool = False) -> str:
    """Save an image under public/assets atomically (temp file, then rename).

    A run killed mid-save leaves no truncated image behind for add_missing_icons() to take as
    present, and a name from the game data that would climb out of public/assets ("..", a drive or
    an absolute path) is refused.

    @param img The PIL image.
    @param rel_out Its path under public/assets, without extension.
    @param webp Save as WebP (backgrounds) instead of PNG.
    @return The written path under public/assets.
    @raise ValueError For an unsafe name.
    """
    if not SAFE_ASSET.fullmatch(rel_out) or ".." in rel_out.split("/"):
        raise ValueError(f"refusing an unsafe asset name {rel_out!r}")
    out = (config.ASSETS_OUT / rel_out).with_suffix(".webp" if webp else ".png")
    config.out_path(out)
    tmp = out.with_name(out.name + ".tmp")
    if webp:
        img.save(tmp, "WEBP", quality=88, method=6)
    else:
        img.save(tmp, "PNG", optimize=True)
    os.replace(tmp, out)
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


def icons_of(core: dict, powers: list, boosts: dict) -> dict[str, tuple[set[str], str]]:
    """@return Per icon kind: (icon names the data uses, preferred texture folder)."""
    return {
        "powers": ({p["icon"] for p in powers} | {"Power_Missing"}, "gui/icons/powers"),
        "enh": ({b["icon"] for b in boosts["boosts"]}
                | {f for b in boosts["boosts"] for f in b.get("bf", [])}
                | {x["icon"] for x in core["attribNames"]["Boost"]}, "gui/icons/enhancements"),
        "at": ({a["icon"] for a in core["archetypes"]}, "gui/icons/archetype"),
        "origin": ({o["icon"] for o in core["origins"]}, "gui/icons/origin"),
    }


def wanted_icons(data_root) -> dict[str, tuple[set[str], str]]:
    """@return Per icon kind: (shared icon names the data in `data_root` uses, preferred texture folder).

    Names in another server's own folder ("thunderspy:<name>") are left out: they aren't shared icons.
    """
    core = json.loads((data_root / "core.json").read_text(encoding="utf-8"))
    powers = json.loads((data_root / "powers.json").read_text(encoding="utf-8"))
    boosts = json.loads((data_root / "boosts.json").read_text(encoding="utf-8"))
    return {k: ({n for n in names if ":" not in n}, prefer)
            for k, (names, prefer) in icons_of(core, powers, boosts).items()}


SAME_ICON = 2.0  # mean difference (0-255) under which two icons are the same art (icon_difference)
NEAR_ICON = 8.0  # differing icons under this are listed in the report for a look


def icon_difference(a: Image.Image, b: Image.Image) -> float:
    """How different two icons look: the mean absolute channel difference (0-255) of both drawn
    over black at 32x32.

    Comparing small renders instead of bytes treats a re-encoded or upscaled copy of the same art
    as the same icon. On Thunderspy's client, 486 of 494 icons it shares with Homecoming measure
    under 2; the rest are redrawn art (10 to 37).

    @param a One icon.
    @param b The other.
    @return The difference.
    """
    def norm(img: Image.Image) -> Image.Image:
        img = img.convert("RGBA")
        bg = Image.new("RGBA", img.size, (0, 0, 0, 255))
        bg.alpha_composite(img)
        return bg.convert("RGB").resize((32, 32), Image.LANCZOS)
    return sum(ImageStat.Stat(ImageChops.difference(norm(a), norm(b))).mean) / 3


def _rename_icons(out: dict, rename: dict[tuple[str, str], str]) -> None:
    """Rename icon references in exported data in place: (kind, name) -> new name."""
    def fix(kind: str, name: str) -> str:
        return rename.get((kind, name), name)
    for p in out["powers"]:
        p["icon"] = fix("powers", p["icon"])
    for b in out["boosts"]["boosts"]:
        b["icon"] = fix("enh", b["icon"])
        if b.get("bf"):
            b["bf"] = [fix("enh", f) for f in b["bf"]]
    for x in out["core"]["attribNames"]["Boost"]:
        x["icon"] = fix("enh", x["icon"])
    for a in out["core"]["archetypes"]:
        a["icon"] = fix("at", a["icon"])
    for o in out["core"]["origins"]:
        o["icon"] = fix("origin", o["icon"])


def plan_icon_overlay(out: dict, server: str) -> dict:
    """Decide every icon another server ships, and name them so in its data; writes nothing.

    The server keeps its own copy of every icon its data shows, in public/assets/<server>/icons/,
    and its data names them "<server>:<name>":
    - art the same as the shared icon of that name (icon_difference under SAME_ICON) is a copy of
      the shared file's bytes, so the default art shows and Git stores the file once, while a
      later Homecoming redraw of the shared file can't change what this server shows;
    - redrawn art, or art Homecoming lacks, is the server's own texture;
    - no texture of its own: a copy of the shared file (Homecoming's frame art);
    - no texture anywhere: the name stays as it is (no file, as on Homecoming).
    The files are written later by write_icon_overlay, once the run may write anything.

    @param out The export about to be written (Exporter.build()); icon names change in place.
    @param server The server id (its overlay folder).
    @return The plan: "files" [(kind, file name, path under public/assets without extension, PIL
        image or PNG bytes)] and the report summary {"same": count, "changed": {kind: [(name,
        difference)]}, "new": {kind: [names]}, "shared_fallback": {kind: [names]}, "missing": {kind:
        [names]}, "conflicts": [(name, [piggs])]}.
    @raise SystemExit For an icon name that can't be a file name (nothing has been written).
    """
    ix = TextureIndex()
    wanted = icons_of(out["core"], out["powers"], out["boosts"])
    res: dict = {"same": 0, "changed": {}, "new": {}, "shared_fallback": {}, "missing": {},
                 "conflicts": []}
    files: list[tuple[str, str, str, object]] = []
    rename: dict[tuple[str, str], str] = {}
    for kind, (names, prefer) in wanted.items():
        for k in ("changed", "new", "shared_fallback", "missing"):
            res[k][kind] = []
        # Power_Missing is the app's own fallback ('power_missing'), always the shared file
        for name in sorted(n for n in names if n and n != "Power_Missing"):
            low = name.lower()
            rel = f"{server}/icons/{kind}/{low}"
            if "/" in low or not SAFE_ASSET.fullmatch(rel) or ".." in rel.split("/"):
                raise SystemExit(f"error: the {kind} icon name {name!r} can't be a file name; "
                                 "nothing was written")
            shared = config.ASSETS_OUT / "icons" / kind / f"{_file_stem(low)}.png"
            src = ix.find(name, prefer)
            if src is not None and src.rel in ix.overridden:
                differ = ix.differing(src.rel)
                if differ:
                    res["conflicts"].append((name, differ))
            if src is None:
                if not shared.is_file():
                    res["missing"][kind].append(name)
                    continue
                res["shared_fallback"][kind].append(name)
                payload: object = shared.read_bytes()
            else:
                img = decode(src.read())
                payload = img
                if shared.is_file():
                    with Image.open(shared) as pub:
                        diff = icon_difference(img, pub)
                    if diff < SAME_ICON:
                        res["same"] += 1
                        payload = shared.read_bytes()
                    else:
                        res["changed"][kind].append((name, round(diff, 1)))
                else:
                    res["new"][kind].append(name)
            files.append((kind, low, rel, payload))
            rename[(kind, name)] = f"{server}:{name}"
    _rename_icons(out, rename)
    return {"server": server, "files": files, "summary": res}


def write_icon_overlay(plan: dict, add_only: bool) -> int:
    """Write a planned overlay (plan_icon_overlay) and add its names to the server's manifest.

    The manifest only grows, so icons an older version of the server still names stay listed.

    @param plan The plan.
    @param add_only Write only files the folder lacks (an older version of the server: the newest
        version's art stays, as add_missing_icons does for the shared icons).
    @return How many files were written.
    """
    server = plan["server"]
    mpath = config.ASSETS_OUT / server / "manifest.json"
    try:
        manifest = json.loads(mpath.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        manifest = {"icons": {}}
    n = 0
    for kind, low, rel, payload in plan["files"]:
        manifest["icons"][kind] = sorted(set(manifest["icons"].get(kind, [])) | {low})
        if add_only and (config.ASSETS_OUT / rel).with_suffix(".png").is_file():
            continue
        if isinstance(payload, bytes):
            _write_bytes(payload, rel)
        else:
            _write(payload, rel)
        n += 1
    config.atomic_write(mpath, json.dumps(manifest, separators=(",", ":")))
    return n


def _write_bytes(data: bytes, rel_out: str) -> str:
    """Save PNG bytes under public/assets (a copy of a shared icon), with _write's name checks.

    @param data The PNG file's bytes.
    @param rel_out Its path under public/assets, without extension.
    @return The written path under public/assets.
    @raise ValueError For an unsafe name.
    """
    if not SAFE_ASSET.fullmatch(rel_out) or ".." in rel_out.split("/"):
        raise ValueError(f"refusing an unsafe asset name {rel_out!r}")
    out = (config.ASSETS_OUT / rel_out).with_suffix(".png")
    config.atomic_write(out, data)
    return out.relative_to(config.ASSETS_OUT).as_posix()


def _file_stem(low: str) -> str:
    """@return The file name _write gives an icon (it swaps any extension, such as .tga, for .png)."""
    return PurePosixPath(low).stem


def add_missing_icons(data_root) -> dict:
    """Add only the icons an older game version needs that public/assets does not have yet.

    The shared assets come from the default version's client. An older client must never
    overwrite them (an icon redrawn in a later patch would change for every version), so this
    writes no UI chrome, fonts or sounds and skips every icon file that already exists.

    @param data_root The older version's data folder.
    @return {"counts": icons added per kind, "missing": names no texture was found for}.
    """
    ix = TextureIndex()
    mpath = config.ASSETS_OUT / "manifest.json"
    try:
        manifest = json.loads(mpath.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise SystemExit(f"error: public/assets/manifest.json is unreadable ({e}); export the default "
                         "version's assets first")
    added: dict[str, list[str]] = {}
    missing: dict[str, list[str]] = {}
    for kind, (names, prefer) in wanted_icons(data_root).items():
        have = set(manifest["icons"].get(kind, []))
        got, miss = [], []
        for name in sorted(n for n in names if n):
            low = name.lower()
            if low in have or (config.ASSETS_OUT / "icons" / kind / f"{low}.png").exists():
                continue
            src = ix.find(name, prefer)
            if src is None:
                miss.append(name)
                continue
            _write(decode(src.read()), f"icons/{kind}/{low}")
            got.append(low)
        if got:
            manifest["icons"][kind] = sorted(have | set(got))
        added[kind] = got
        missing[kind] = miss
    if any(added.values()):
        config.atomic_write(mpath, json.dumps(manifest, separators=(",", ":")))
    return {"counts": {k: len(v) for k, v in added.items()}, "missing": missing, "added": added}


def add_missing_ui() -> list[str]:
    """Add only the UI textures UI_PREFIXES and UI_FILES name that public/assets does not have yet.

    A whole run for the default version exports them too (run), with everything else. This is for
    a texture a new screen needs between patches: it writes no other file and never overwrites
    one, so art already published stays as it is.

    @return The paths added, as the manifest lists them.
    @raise SystemExit When public/assets/manifest.json is unreadable.
    """
    ix = TextureIndex()
    mpath = config.ASSETS_OUT / "manifest.json"
    try:
        manifest = json.loads(mpath.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise SystemExit(f"error: public/assets/manifest.json is unreadable ({e}); export the default "
                         "version's assets first")
    have = set(manifest.get("ui", []))
    added = []
    for rel, src in sorted(ix.by_rel.items()):
        if not (rel.startswith(UI_PREFIXES) or rel in UI_FILES):
            continue
        stem = f"ui/{rel[len('gui/'):]}"
        if any(f"{stem}{ext}" in have or (config.ASSETS_OUT / f"{stem}{ext}").exists() for ext in (".png", ".webp")):
            continue
        img = decode(src.read())
        added.append(_write(img, stem, webp=img.width * img.height >= 256 * 256))
    if added:
        manifest["ui"] = sorted(have | set(added))
        config.atomic_write(mpath, json.dumps(manifest, separators=(",", ":")))
        write_skin_variants(manifest["ui"])
    return added


def keep_older_icons(manifest: dict, data_root) -> None:
    """Keep listing the icons other version folders need that this run's data does not.

    Older versions add icons the default version lacks (add_missing_icons); a full run for the
    default version must not drop them, or the manifest would shrink and the check would refuse.

    @param manifest The manifest being built; its icon lists are extended in place.
    @param data_root The folder this run exported (its own icons are already listed).
    """
    for other in config.version_folders():  # every server's: another server uses shared icons too
        if other.resolve() == data_root.resolve():
            continue
        for kind, (names, _prefer) in wanted_icons(other).items():
            have = set(manifest["icons"].get(kind, []))
            extra = {n.lower() for n in names if n} - have
            extra = {n for n in extra if (config.ASSETS_OUT / "icons" / kind / f"{n}.png").is_file()}
            if extra:
                manifest["icons"][kind] = sorted(have | extra)


def run(data_root) -> dict:
    """Export every asset referenced by the exported data in `data_root` (icons older versions
    still need stay listed)."""
    ix = TextureIndex()
    wanted = wanted_icons(data_root)
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
        if not (rel.startswith(UI_PREFIXES) or rel in UI_FILES):
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

    keep_older_icons(manifest, data_root)

    mpath = config.ASSETS_OUT / "manifest.json"
    try:
        prev = json.loads(mpath.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        prev = None
    # icon kinds this run does not make (salvage: pipeline.recipes) stay listed as they were
    for kind, names in ((prev or {}).get("icons") or {}).items():
        manifest["icons"].setdefault(kind, names)
    # with no manifest to say so (it was deleted), such a kind is listed from its folder
    icons_dir = config.ASSETS_OUT / "icons"
    for folder in sorted(p for p in icons_dir.iterdir() if p.is_dir()) if icons_dir.is_dir() else []:
        manifest["icons"].setdefault(folder.name, sorted(f.stem for f in folder.glob("*.png")))
    check_not_smaller(manifest, prev)
    config.atomic_write(mpath, json.dumps(manifest, separators=(",", ":")))
    write_skin_variants(manifest["ui"])
    return {"counts": {k: len(v) for k, v in manifest["icons"].items()} | {
        "ui": len(manifest["ui"]), "fonts": len(manifest["fonts"]),
        "sounds": len(manifest["sounds"])}, "missing": missing}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.parse_args()
    config.select_server(config.HOMECOMING.id)
    config.preflight()
    added = add_missing_ui()
    print(f"UI textures added: {len(added)}")
    for a in added:
        print(f"  {a}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
