"""Extract game textures (icons and UI chrome) to PNG for the site.

A `.texture` file is: TextureFileHeader {i32 headerSize, i32 fileSize, i32 width, i32 height, ...}
+ internal path + image data (DDS, occasionally TGA) starting at `headerSize`. The DDS is padded
to a power of two, so the decoded image is cropped to the header's width x height.

Sources, later ones override earlier ones (matched by lower-cased path under texture_library/):
  1. I24 loose files: CityOfHeroes_OuroV2_Data/bin/data/texture_library/ (only when COH_SOURCE is set)
  2. I24 client piggs (assets/issue24 texGui1/stage1b/stage2/stage3.pigg: the same content, used only when the loose
     folder is not available, i.e. COH_SOURCE is unset)
  3. live Homecoming overlay: assets/live/texture_gui.pigg (and texture_library.pigg if needed)
"""
from __future__ import annotations

import io
import struct
import zlib
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

from pipeline import config
from pipeline.coh import p7reader as P  # noqa: F401  (puts the repo's tools/ on sys.path)

import pigg_extract as pex  # noqa: E402

LOOSE_ROOT = config.OURO_DATA / "bin" / "data" / "texture_library" if config.OURO_DATA else None
I24_PIGGS = [config.I24_ASSETS / n for n in ("texGui1.pigg", "stage1b.pigg", "stage2.pigg", "stage3.pigg")]
LIVE_PIGGS = [config.LIVE_ASSETS / "texture_gui.pigg", config.LIVE_ASSETS / "texture_library.pigg"]


@dataclass
class TexSource:
    """Where one texture lives: a loose file, or a pigg entry."""

    rel: str                      # lower-cased path relative to texture_library/, no extension
    file: Path | None = None
    pigg: Path | None = None
    entry: dict | None = None

    def read(self) -> bytes:
        if self.file is not None:
            return self.file.read_bytes()
        with open(self.pigg, "rb") as f:
            f.seek(self.entry["offset"])
            raw = f.read(self.entry["packSize"] or self.entry["size"])
        return zlib.decompress(raw) if self.entry["packSize"] else raw


class TextureIndex:
    """Lookup of every available texture by relative path and by bare name."""

    def __init__(self, gui_only: bool = True):
        self.by_rel: dict[str, TexSource] = {}
        loose = LOOSE_ROOT is not None and LOOSE_ROOT.is_dir()
        if loose:
            root = LOOSE_ROOT / "GUI" if gui_only else LOOSE_ROOT
            for f in root.rglob("*.texture"):
                rel = f.relative_to(LOOSE_ROOT).with_suffix("").as_posix().lower()
                self.by_rel[rel] = TexSource(rel, file=f)
        for pg in ([] if loose else I24_PIGGS) + LIVE_PIGGS:
            if not pg.exists():
                continue
            with open(pg, "rb") as fh:
                for e in pex.read_directory(fh):
                    path = e["path"].replace("\\", "/").lower()
                    if not path.startswith("texture_library/") or not path.endswith(".texture"):
                        continue
                    rel = path[len("texture_library/"):-len(".texture")]
                    if gui_only and not rel.startswith("gui/"):
                        continue
                    self.by_rel[rel] = TexSource(rel, pigg=pg, entry=e)
        self.by_name: dict[str, list[TexSource]] = {}
        for src in self.by_rel.values():
            self.by_name.setdefault(src.rel.rsplit("/", 1)[-1], []).append(src)

    def find(self, name: str, prefer: str = "") -> TexSource | None:
        """Texture by bare name (any extension stripped), preferring paths under `prefer`."""
        key = name.lower().rsplit("/", 1)[-1]
        for ext in (".tga", ".dds", ".texture", ".ico", ".png"):
            if key.endswith(ext):
                key = key[: -len(ext)]
        cands = self.by_name.get(key, [])
        if not cands:
            return None
        if prefer:
            for c in cands:
                if c.rel.startswith(prefer.lower()):
                    return c
        return cands[0]


def decode(data: bytes) -> Image.Image:
    """Decode a .texture blob to an RGBA image cropped to its true size."""
    hsize, _fsize, width, height = struct.unpack_from("<4i", data, 0)
    img = Image.open(io.BytesIO(data[hsize:]))
    img.load()
    img = img.convert("RGBA")
    if width > 0 and height > 0 and (img.width, img.height) != (width, height):
        img = img.crop((0, 0, min(width, img.width), min(height, img.height)))
    return img


def export_png(src: TexSource, out: Path) -> tuple[int, int]:
    """Write `src` as an optimized PNG; returns its (width, height)."""
    img = decode(src.read())
    p = config.out_path(out)
    img.save(p, "PNG", optimize=True)
    return img.width, img.height
