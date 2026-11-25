"""Tests for pipeline/check_ids.py (python -m unittest pipeline.check_ids_test; run by CI)."""
from __future__ import annotations

import contextlib
import io
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from pipeline import check_ids

EMPTY = {kind: {} for kind in check_ids.KINDS}


def _registry(**powers: int) -> str:
    """@return An ids file's text holding these powers and nothing else."""
    return json.dumps({**EMPTY, "power": powers})


class IdsFileNames(unittest.TestCase):
    def test_takes_every_servers_ids_file_and_nothing_else(self) -> None:
        for name in ("ids.json", "ids-thunderspy.json", "ids-rebirth.json"):
            self.assertTrue(check_ids.is_ids_file(name), name)
        for name in ("ids.py", "ids-.json", "ids.json.bak", "patch-watch.json", "check_ids.py", "report.md", "kids.json"):
            self.assertFalse(check_ids.is_ids_file(name), name)


class Shape(unittest.TestCase):
    def test_changes_names_what_was_removed_or_renumbered(self) -> None:
        old = {**EMPTY, "power": {"a.b.c": 1, "a.b.d": 2}}
        self.assertEqual(check_ids.changes(old, {**EMPTY, "power": {"a.b.c": 1, "a.b.d": 2, "a.b.e": 3}}), [])
        got = check_ids.changes(old, {**EMPTY, "power": {"a.b.c": 5}})
        self.assertEqual(len(got), 2)
        self.assertIn("renumbered from 1 to 5", got[0])
        self.assertIn("was removed", got[1])

    def test_problems_names_a_reused_id(self) -> None:
        self.assertEqual(check_ids.problems({**EMPTY, "power": {"a": 1, "b": 2}}), [])
        self.assertTrue(any("used by both" in p for p in check_ids.problems({**EMPTY, "power": {"a": 1, "b": 1}})))


class AgainstBase(unittest.TestCase):
    """main() in a throwaway repository whose base commit holds two servers' ids files."""

    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.pipeline = self.root / "pipeline"
        self.pipeline.mkdir()
        (self.pipeline / "ids.json").write_text(_registry(**{"a.b.c": 1}), encoding="utf-8")
        (self.pipeline / "ids-other.json").write_text(_registry(**{"x.y.z": 1, "x.y.w": 2}), encoding="utf-8")
        for args in (["init", "-q"], ["add", "."], ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-q", "-m", "base"]):
            subprocess.run(["git", *args], cwd=self.root, check=True, capture_output=True)
        cwd = os.getcwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, cwd)
        # this branch's config names the first server only: the second was dropped from it
        for patch in (
            mock.patch.object(check_ids, "HERE", self.pipeline),
            mock.patch.object(check_ids, "registries", lambda: [(self.pipeline / "ids.json", self.root / "public" / "data")]),
        ):
            patch.start()
            self.addCleanup(patch.stop)

    def _run(self) -> tuple[int, str]:
        """@return main()'s exit status against the base commit, and what it printed."""
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            status = check_ids.main(["check_ids.py", "HEAD"])
        return status, out.getvalue()

    def test_passes_while_every_base_file_only_grows(self) -> None:
        (self.pipeline / "ids-other.json").write_text(_registry(**{"x.y.z": 1, "x.y.w": 2, "x.y.v": 3}), encoding="utf-8")
        status, out = self._run()
        self.assertEqual(status, 0, out)
        self.assertIn("pipeline/ids-other.json: well formed, only appended to since HEAD", out)

    def test_a_server_dropped_from_the_config_keeps_its_ids_checked(self) -> None:
        (self.pipeline / "ids-other.json").write_text(_registry(**{"x.y.z": 2, "x.y.w": 1}), encoding="utf-8")
        status, out = self._run()
        self.assertEqual(status, 1, out)
        self.assertIn("pipeline/ids-other.json: power: 'x.y.z' was renumbered from 1 to 2", out)

    def test_a_server_dropped_from_the_config_cannot_lose_its_ids_file(self) -> None:
        (self.pipeline / "ids-other.json").unlink()
        status, out = self._run()
        self.assertEqual(status, 1, out)
        self.assertIn("pipeline/ids-other.json was deleted", out)


if __name__ == "__main__":
    unittest.main()
