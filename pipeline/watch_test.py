"""Tests for pipeline/watch.py: python -m unittest pipeline.watch_test (run by CI).

No network and no client install: manifests are written here, and the installed client's hashes and
the published version are given to the checks directly.
"""
from __future__ import annotations

import json
import unittest
from unittest import mock

from pipeline import config
from pipeline import watch as W

TS = config.THUNDERSPY
BIN_MD5, EXE_MD5 = "a" * 32, "b" * 32
BIN_SHA, EXE_SHA = "c" * 40, "d" * 40


def manifest(bin_release: str = "9.6", bin_md5: str = BIN_MD5, exe_md5: str = EXE_MD5) -> bytes:
    """@return A launcher manifest naming Thunderspy's bin pigg and exe (the live one's shape)."""
    return (f'<?xml version=\'1.0\' encoding=\'utf-8\'?>\n<manifest><label>City of Heroes</label><filelist>'
            f'<file name="tspy/bin.pigg" md5="{bin_md5}" size="1">'
            f'<url>https://dists.example.org/{bin_release}/tspy/bin.pigg</url></file>'
            f'<file name="Thunderspy.exe" md5="{exe_md5}" size="1">'
            f'<url>https://dists.example.org/10.1/Thunderspy.exe</url></file>'
            f'</filelist></manifest>').encode()


ENTRY = {"manifest": "https://example.org/live.xml", "binRelease": "9.6", "binMd5": BIN_MD5,
         "gameVersion": "ts9-6", "gameLabel": "Release 9.6"}
LOCAL = {"tspy/bin.pigg": (BIN_MD5, BIN_SHA), "Thunderspy.exe": (EXE_MD5, EXE_SHA)}
PUB = W.Published("ts9-6", "Release 9.6", {"exe": EXE_SHA, "bin.pigg": BIN_SHA, "bin_powers.pigg": BIN_SHA},
                  "homecoming/i28p4", frozenset({"ts9-6"}))


def levels(lines: list[tuple[str, str]]) -> list[str]:
    """@return The level of each line, commands left out."""
    return [lv for lv, _ in lines if lv != W.CMD]


class ManifestTest(unittest.TestCase):
    """Reading a manifest from outside."""

    def test_reads_files_and_releases(self):
        live = W.parse_manifest(manifest())
        self.assertEqual(live["tspy/bin.pigg"], W.LiveFile(BIN_MD5, "https://dists.example.org/9.6/tspy/bin.pigg", "9.6"))
        self.assertEqual(live["Thunderspy.exe"].release, "10.1")

    def test_refuses_malformed_or_risky_manifests(self):
        bad = {
            "doctype": b'<?xml version="1.0"?><!DOCTYPE m [<!ENTITY a "b">]><manifest/>',
            "utf-16": '<manifest><!DOCTYPE m></manifest>'.encode("utf-16"),
            "other encoding": b'<?xml version="1.0" encoding="latin-1"?><manifest/>',
            "not xml": b"<manifest><filelist>",
            "bad md5": manifest(bin_md5="zz"),
            "twice": manifest().replace(b"Thunderspy.exe", b"tspy/bin.pigg"),
        }
        for what, data in bad.items():
            with self.subTest(what), self.assertRaises(W.WatchError):
                W.parse_manifest(data)

    def test_release_folder(self):
        self.assertEqual(W.release_of("https://h/10.1/Thunderspy.exe", "Thunderspy.exe"), "10.1")
        for url in ("http://h/9.6/tspy/bin.pigg", "https://h/x/9.6/tspy/bin.pigg", "https://h/tspy/bin.pigg",
                    "https://h/9.6/other/bin.pigg"):
            with self.subTest(url):
                self.assertEqual(W.release_of(url, "tspy/bin.pigg"), "")

    def test_fetch_refuses_plain_http(self):
        with self.assertRaises(W.WatchError):
            W.fetch("http://example.org/live.xml")


class AssessTest(unittest.TestCase):
    """What the check reports for each state of the live manifest, the install and the published data."""

    def test_everything_current(self):
        self.assertEqual(levels(W.assess(TS, ENTRY, W.parse_manifest(manifest()), LOCAL, PUB)), ["ok", "ok", "ok"])

    def test_new_release_prints_its_export_command(self):
        live = W.parse_manifest(manifest("9.7", "e" * 32))
        out = W.assess(TS, ENTRY, live, LOCAL, PUB)
        self.assertEqual(levels(out), ["todo", "todo", "ok"])  # the install is still 9.6, as published
        cmds = [t for lv, t in out if lv == W.CMD]
        self.assertEqual(cmds[0], 'python -m pipeline.run --server thunderspy --game-version ts9-7 '
                                  '--game-label "Release 9.7" --frames-from homecoming/i28p4 --make-default')
        self.assertEqual(cmds[1], "python -m pipeline.watch --record")

    def test_a_file_replaced_in_the_same_release_needs_a_new_id(self):
        out = W.assess(TS, ENTRY, W.parse_manifest(manifest(bin_md5="e" * 32)), None, PUB)
        self.assertEqual(levels(out), ["todo", "note"])
        self.assertIn("<new id; ts9-6 is published>", [t for lv, t in out if lv == W.CMD][0])

    def test_upper_case_md5_is_the_same_file(self):
        entry = {**ENTRY, "binMd5": BIN_MD5.upper()}
        self.assertEqual(levels(W.assess(TS, entry, W.parse_manifest(manifest()), LOCAL, PUB))[0], "ok")

    def test_no_recorded_release(self):
        entry = {k: v for k, v in ENTRY.items() if k not in ("binRelease", "binMd5")}
        out = W.assess(TS, entry, W.parse_manifest(manifest()), LOCAL, PUB)
        self.assertIn("records no release", out[0][1])

    def test_missing_md5_asks_for_record(self):
        entry = {k: v for k, v in ENTRY.items() if k != "binMd5"}
        self.assertEqual(levels(W.assess(TS, entry, W.parse_manifest(manifest()), LOCAL, PUB))[0], "todo")

    def test_exe_only_update_is_a_note(self):
        live = W.parse_manifest(manifest(exe_md5="f" * 32))
        local = {**LOCAL, "Thunderspy.exe": ("f" * 32, "f" * 40)}
        self.assertEqual(levels(W.assess(TS, ENTRY, live, local, PUB)), ["ok", "ok", "note"])

    def test_recorded_but_not_exported(self):
        pub = W.Published("ts9-6", "Release 9.6", {**PUB.source, "bin.pigg": "0" * 40}, None, PUB.ids)
        self.assertEqual(levels(W.assess(TS, ENTRY, W.parse_manifest(manifest()), LOCAL, pub)), ["ok", "ok", "todo"])

    def test_manifest_without_the_bin_pigg(self):
        with self.assertRaises(W.WatchError):
            W.assess(TS, ENTRY, W.parse_manifest(manifest().replace(b'"tspy/bin.pigg"', b'"tspy/x.pigg"')), LOCAL, PUB)


class RecordTest(unittest.TestCase):
    """--record writes only what was exported."""

    def test_refused_until_the_default_version_is_the_live_release(self):
        live = W.parse_manifest(manifest("9.7", "e" * 32))
        updated = {**LOCAL, "tspy/bin.pigg": ("e" * 32, "1" * 40)}
        for local in (None, LOCAL, updated):  # no install, an old install, an updated one not exported
            with self.subTest(local=local), self.assertRaises(W.WatchError):
                W.record(TS, ENTRY, live, local, PUB)
        pub = W.Published("ts9-7", "Release 9.7", {**PUB.source, "bin.pigg": "1" * 40}, PUB.frames_from,
                          PUB.ids | {"ts9-7"})
        new = W.record(TS, ENTRY, live, updated, pub)
        self.assertEqual(new, {**ENTRY, "binRelease": "9.7", "binMd5": "e" * 32, "gameVersion": "ts9-7",
                               "gameLabel": "Release 9.7"})
        self.assertEqual(list(new), list(ENTRY))  # keys keep their order
        self.assertEqual(levels(W.assess(TS, new, live, updated, pub)), ["ok", "ok", "ok"])


class OutputTest(unittest.TestCase):
    """What the owner reads and the exit status a scheduled job sees."""

    def test_commands_print_whole_and_messages_keep_flags_intact(self):
        cmd = "python -m pipeline.run --server thunderspy --game-version ts9-7 --frames-from homecoming/i28p4 " * 2
        self.assertEqual(W.render(W.CMD, cmd), " " * 8 + cmd)
        text = W.render(W.TODO, "x" * 90 + " --frames-from homecoming/i28p4")
        self.assertTrue(any(line.strip().startswith("--frames-from") for line in text.splitlines()))

    def test_published_default_reads_the_committed_data(self):
        pub = W.published_default("thunderspy")
        self.assertIsNotNone(pub)
        self.assertIn(pub.id, pub.ids)
        self.assertEqual(len(pub.source["bin.pigg"]), 40)

    def test_exit_status(self):
        watch_file = mock.Mock(read_text=mock.Mock(return_value=json.dumps({"thunderspy": ENTRY})))
        with mock.patch.object(W, "PATCH_WATCH", watch_file), mock.patch.object(W, "installed", return_value=None),                 mock.patch.object(W, "published_default", return_value=PUB), mock.patch("builtins.print"):
            for live, status in ((manifest(), 0), (manifest("9.7"), 1), (W.WatchError("offline"), 2)):
                with self.subTest(status=status), mock.patch.object(
                        W, "fetch", **({"side_effect": live} if isinstance(live, Exception) else {"return_value": live})):
                    self.assertEqual(W.main(["--server", "thunderspy"]), status)

if __name__ == "__main__":
    unittest.main()
