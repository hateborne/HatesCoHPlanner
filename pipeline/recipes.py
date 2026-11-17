"""Write a game version's recipe file, and nothing else.

The recipe file (<server data>/recipes/<version>.json) says, for every set enhancement a dropped
recipe makes, the recipe's name and rarity and the invention salvage it takes at each level. It is
decoded from the client's baserecipes.bin and salvage.bin (parse tables from the client's exe, as
every other decoder here), with boostsets.bin telling which enhancements are set pieces. The set
finder's shopping list reads it; no link, saved build or loader does. It sits beside the version
folders, so a published folder never changes:

    python -m pipeline.recipes                                  # the default version
    python -m pipeline.recipes --game-version i28p3             # COH_CLIENT pointing at a copy of its client

The configured client must be the one the version was made from (the exe and pigg hashes in its
core.json manifest.source): any other client is refused. The version folder, versions.json, the
ids file and the reports are left alone. The salvage icons the file names go to
public/assets/icons/salvage: the server's default version writes them all (so art redrawn in a
patch arrives), any other version only adds the ones not there yet, as the other icons do.
pipeline.run writes the same file along with the rest of a new version (export.write).

File format (version 1):

    {"v": 1, "dataVersion": "<version>",
     "salvage": [[display name, rarity, icon], ...],
     "recipes": {"<the enhancement's full name>": {"dn": recipe name, "r": rarity,
                 "t": [[first level, last level, [salvage index, ...]], ...], "lv": [levels]}}}

Levels are the recipe's own, as the game shows them (1-based). A tier covers the recipe levels from
its first to its last that exist; "lv" lists them when they are not every level in between (no set
recipe is so today). A salvage index names an entry of "salvage" and is repeated when the recipe
takes more than one. Rarity is 1 common, 2 uncommon, 3 rare, 4 very rare.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline import config  # noqa: E402

FORMAT = 1
# the client's rarity names (RecipeRarityParseEnum in DetailRecipe.c, RarityEnum in salvage.c)
RARITY = {"Common": 1, "Uncommon": 2, "Rare": 3, "VeryRare": 4}
# preferred texture folder of salvage icons
SALVAGE_ICONS = "gui/icons/salvage"
# an icon name the app takes (checkRecipes in src/data/recipes.ts refuses a file with any other)
ICON_NAME = re.compile(r"[a-z0-9_]*")


def decode() -> dict:
    """Decode the configured client's recipes, salvage and the enhancements that are set pieces.

    The bins are earrays of structs whose links are inline strings. The parse tables are the
    client's own: parse_detailrecipe (DetailRecipe.c), ParseSalvageDef (salvage.c) and the boost
    set table live.py reads.

    @return {"recipes": records, "salvage": records, "set_pieces": {lower-case enhancement names},
        "messages": {key: English text}, "enums": {"recipe.Type", "recipe.Rarity", "salvage.Type",
        "salvage.Rarity"}, "health": {bin: {...}}}.
    """
    from pipeline.coh import p7reader as P
    from pipeline.coh.messages import decode_messages

    recipe_table = P.pick_table("CreatesEnhancement", {"Name", "Salvage", "Enhancement", "Rarity", "Level", "Type"})
    salvage_table = P.pick_table("MinReverseEngineerLevel", {"Name", "DisplayName", "Rarity", "Type", "Icon"})
    health: dict = {}
    out: dict = {"health": health}
    for key, member, table in (("recipes", "bin/baserecipes.bin", recipe_table),
                               ("salvage", "bin/salvage.bin", salvage_table)):
        res = P.decode_earray(P.load_member(config.BIN_PIGG, member), table, inline_links=True)
        health[member] = {"records": len(res.records), "clean": res.clean, "partial": len(res.partial),
                          "partial_examples": res.partial[:5]}
        out[key] = res.records
    sets = P.decode_earray(P.load_member(config.BIN_PIGG, "bin/boostsets.bin"),
                           P.pick_table("ConversionGroups", {"Name", "DisplayName", "Powers"}), inline_links=True)
    health["bin/boostsets.bin"] = {"records": len(sets.records), "clean": sets.clean, "partial": len(sets.partial),
                                   "partial_examples": sets.partial[:5]}
    out["set_pieces"] = {(b or "").lower() for s in sets.records for lst in s.get("BoostLists") or []
                         for b in lst.get("Boosts") or []}
    out["messages"] = decode_messages(P.load_member(config.BIN_PIGG, "bin/clientmessages-en.bin"))
    out["enums"] = {"recipe.Type": P.enum_of(recipe_table, "Type"), "recipe.Rarity": P.enum_of(recipe_table, "Rarity"),
                    "salvage.Type": P.enum_of(salvage_table, "Type"), "salvage.Rarity": P.enum_of(salvage_table, "Rarity")}
    return out


def _value_of(enum: dict, name: str) -> int | None:
    """@return The value an enum gives a name, or None when it has no such name."""
    return next((v for v, n in enum.items() if n == name), None)


def icon_name(texture: str) -> str:
    """A texture's file name as public/assets holds it: lower case, no extension.

    Whatever follows the last dot goes, as the client's texture lookup drops it: one salvage item
    names its icon "salvage_Iron.tgs".

    @param texture The icon as the client's data names it.
    @return The name, "" for none.
    """
    low = (texture or "").replace("\\", "/").rsplit("/", 1)[-1].lower()
    return low[: low.rfind(".")] if "." in low else low


def build(decoded: dict, version: str) -> tuple[dict, dict]:
    """The recipe file's content, from decoded client records.

    Only recipes that drop (Type Drop) and make a set enhancement are kept: the ones a player
    finds, buys at the auction house and crafts at a worktable for a set. Store, merit, ticket and
    memorized recipes for the same enhancements are other ways to the same piece and are left out,
    as are common IO recipes (the shopping list only holds set pieces).

    Anything that would make the file wrong is listed in the summary's "problems" (and the file is
    then not written): a salvage name with no definition, a name with no text, an unknown rarity,
    an icon name the app would refuse the file over, two dropped recipes for one enhancement and
    level (names compared without case, as the app looks them up), levels of one enhancement that
    disagree on the recipe's name or rarity, or no set recipe at all (the client's set list was
    not read: every recipe would be left out, and a good file replaced by an empty one).

    @param decoded decode()'s result (or the same shape, in tests).
    @param version Game version id.
    @return (file content, {"recipes", "enhancements", "salvage", "not_set": dropped recipes left
        out for making no set piece, "problems": [text]}).
    """
    enums, messages = decoded["enums"], decoded["messages"]
    problems: list[str] = []
    drop = _value_of(enums["recipe.Type"], "Drop")
    invention = _value_of(enums["salvage.Type"], "Invention")
    if drop is None or invention is None:
        problems.append("the client's enums have no Drop recipe type or no Invention salvage type")
    defs = {s.get("Name") or "": s for s in decoded["salvage"]}

    def rarity(enum_key: str, value, what: str) -> int:
        r = RARITY.get(enums[enum_key].get(value, ""))
        if r is None:
            problems.append(f"{what}: unknown rarity {value!r}")
        return r or 1

    def text(key, what: str) -> str:
        t = messages.get(key or "")
        if not t:
            problems.append(f"{what}: no text for its name")
        return t or ""

    set_pieces = decoded["set_pieces"]
    by_enh: dict[str, dict[int, dict]] = {}
    spelled: dict[str, str] = {}  # lower-case name -> the name as the client first spells it
    kept = not_set = 0
    for r in decoded["recipes"]:
        enh = r.get("Enhancement") or ""
        if not enh or r.get("Type") != drop or not r.get("CreatesEnhancement"):
            continue
        if enh.lower() not in set_pieces:
            not_set += 1
            continue
        kept += 1
        enh = spelled.setdefault(enh.lower(), enh)
        levels = by_enh.setdefault(enh, {})
        level = r.get("Level") or 0
        if level in levels:
            problems.append(f"{enh}: two dropped recipes at level {level}")
        levels[level] = r

    used: set[str] = set()
    for levels in by_enh.values():
        for r in levels.values():
            used.update(s.get("Salvage") or "" for s in r.get("Salvage") or [])
    salvage_names = sorted(used)
    index = {n: i for i, n in enumerate(salvage_names)}
    salvage_out = []
    for n in salvage_names:
        d = defs.get(n)
        if d is None:
            problems.append(f"salvage {n!r} has no definition")
            salvage_out.append([n, 1, ""])
            continue
        if d.get("Type") != invention:
            problems.append(f"salvage {n!r} is not invention salvage")
        icon = icon_name(d.get("Icon") or "")
        if not ICON_NAME.fullmatch(icon):
            problems.append(f"salvage {n!r}: the app takes no icon named {icon!r} (lower-case letters, digits and _ only)")
        salvage_out.append([text(d.get("DisplayName"), f"salvage {n}"), rarity("salvage.Rarity", d.get("Rarity"), f"salvage {n}"), icon])

    recipes_out: dict[str, dict] = {}
    for enh in sorted(by_enh):
        levels = by_enh[enh]
        order = sorted(levels)
        first = levels[order[0]]
        names = {r.get("DisplayName") for r in levels.values()}
        rarities = {r.get("Rarity") for r in levels.values()}
        if len(names) > 1 or len(rarities) > 1:
            problems.append(f"{enh}: its recipes disagree on their name or rarity")
        tiers: list[list] = []
        for lv in order:
            need = [index[s.get("Salvage") or ""] for s in levels[lv].get("Salvage") or []
                    for _ in range(max(1, s.get("Amount") or 1))]
            if tiers and tiers[-1][2] == need:
                tiers[-1][1] = lv
            else:
                tiers.append([lv, lv, need])
        entry: dict = {"dn": text(first.get("DisplayName"), enh), "r": rarity("recipe.Rarity", first.get("Rarity"), enh), "t": tiers}
        if order != list(range(order[0], order[-1] + 1)):
            entry["lv"] = order
        recipes_out[enh] = entry

    if not recipes_out:
        problems.append(f"no dropped recipe makes a set piece ({len(set_pieces)} set pieces read, {not_set} recipes for other "
                        "enhancements): the set list or the recipes were not read as they should be")
    data = {"v": FORMAT, "dataVersion": version, "salvage": salvage_out, "recipes": recipes_out}
    return data, {"recipes": kept, "enhancements": len(recipes_out), "salvage": len(salvage_out), "not_set": not_set,
                  "problems": problems}


def write(data: dict, version: str) -> int:
    """Write a version's recipe file, <server data>/recipes/<version>.json.

    @param data build()'s file content.
    @param version Game version id.
    @return The file's size in bytes.
    """
    text = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    config.atomic_write(config.DATA_OUT / config.RECIPES_FOLDER / f"{version}.json", text)
    return len(text.encode("utf-8"))


def export_icons(data: dict, replace: bool = False) -> dict:
    """Write the salvage icons a recipe file names to public/assets/icons/salvage.

    The shared icons come from the default version's client, so only its export replaces an icon
    file already there (art redrawn in a patch); an older client only adds the ones missing, and
    must never redraw a shared icon. public/assets/manifest.json lists the kind so a later asset
    export keeps it.

    @param data build()'s file content.
    @param replace Write every icon, not only the ones not there yet (the default version).
    @return {"added": [names written], "missing": [names no texture was found for]}.
    """
    from pipeline.assets import export_assets
    from pipeline.assets.textures import TextureIndex, decode as decode_texture

    names = sorted({s[2] for s in data["salvage"] if s[2]})
    folder = config.ASSETS_OUT / "icons" / "salvage"
    ix = None
    added, missing = [], []
    for name in names:
        if not replace and (folder / f"{name}.png").is_file():
            continue
        ix = ix or TextureIndex()
        src = ix.find(name, SALVAGE_ICONS)
        if src is None:
            missing.append(name)
            continue
        export_assets._write(decode_texture(src.read()), f"icons/salvage/{name}")
        added.append(name)
    mpath = config.ASSETS_OUT / "manifest.json"
    try:
        manifest = json.loads(mpath.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        manifest = None  # no asset export yet: the next one lists what is on disk
    if manifest is not None:
        have = sorted(set(manifest.setdefault("icons", {}).get("salvage", [])) | {n for n in names if n not in missing})
        if have != manifest["icons"].get("salvage"):
            manifest["icons"]["salvage"] = have
            config.atomic_write(mpath, json.dumps(manifest, separators=(",", ":")))
    return {"added": added, "missing": missing}


def wanted() -> bool:
    """@return Whether the selected server's versions get a recipe file (the set finder is Homecoming's so far)."""
    return config.SERVER.id == config.HOMECOMING.id


def export_version(version: str, icons: bool = True, replace_icons: bool = False) -> tuple[dict | None, list[str]]:
    """Decode the configured client and write `version`'s recipe file and salvage icons.

    @param version Game version id; the configured client must be the one it was made from.
    @param icons Write salvage icon files (a run asked to write no assets passes False).
    @param replace_icons Replace icon files already there (the server's default version).
    @return (summary with "bytes" and "icons", or None when nothing was written; what to tell the owner).
    """
    decoded = decode()
    bad = [k for k, v in decoded["health"].items() if v["partial"]]
    if bad:
        return None, [f"WARNING: no recipe file written: decode health gate failed ({', '.join(bad)})"]
    data, summary = build(decoded, version)
    if summary["problems"]:
        shown = "; ".join(summary["problems"][:5])
        more = len(summary["problems"]) - 5
        return None, [f"WARNING: no recipe file written: {shown}" + (f" (and {more} more)" if more > 0 else "")]
    summary["bytes"] = write(data, version)
    summary["icons"] = export_icons(data, replace_icons) if icons else {"added": [], "missing": []}
    notes = []
    if summary["icons"]["missing"]:
        notes.append(f"WARNING: no texture for salvage icons: {', '.join(summary['icons']['missing'])}")
    return summary, notes


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--game-version", help="the published version id (default: the server's default)")
    args = ap.parse_args()
    config.select_server(config.HOMECOMING.id)
    from pipeline import export, run
    from pipeline.decode import live

    try:
        default = (config.version_index(config.SERVER.id) or {}).get("default")
    except ValueError as e:
        if not args.game_version:
            print(f"error: {export.data_rel('versions.json')} is unreadable ({e}); pass --game-version")
            return 2
        default = None
    version = args.game_version or default or run.default_game_version()[0]
    if not version or not config.valid_version_id(version):
        print(f"error: no valid game version ({version!r}): pass --game-version")
        return 2
    rel = export.data_rel(version)
    try:
        made = json.loads((config.DATA_OUT / version / "core.json").read_text(encoding="utf-8"))["manifest"]
    except (OSError, ValueError, KeyError):
        print(f"error: {rel} is not a published version (no readable core.json); pipeline.run makes one")
        return 2
    if made.get("approximate"):
        print(f"error: {rel} is an approximate version: its client files are gone, so it has no recipe file")
        return 2
    config.preflight()
    source = {"exe": live.sha1(config.EXE), "bin.pigg": live.sha1(config.BIN_PIGG),
              "bin_powers.pigg": live.sha1(config.POWERS_PIGG)}
    if made.get("source") != source:
        print(f"error: {rel} was made from a different client (exe or pigg hashes differ); point the "
              f"{config.SERVER.env} setting at a copy of the client it was made from. Nothing was written.")
        return 2

    # the default version's client draws the shared icons; with no version list to name it, the one the patch record names
    summary, notes = export_version(version, replace_icons=version == (default or run.default_game_version()[0]))
    for n in notes:
        print(n)
    if summary is None:
        return 1
    print(f"wrote {export.data_rel(config.RECIPES_FOLDER, version + '.json')}: {summary['recipes']} dropped recipes "
          f"for {summary['enhancements']} set enhancements, {summary['salvage']} salvage items ({summary['bytes']} bytes; "
          f"{summary['not_set']} recipes for other enhancements left out); salvage icons written: "
          f"{len(summary['icons']['added'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
