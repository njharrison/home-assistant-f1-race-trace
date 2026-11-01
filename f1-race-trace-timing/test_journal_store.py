import json
import tempfile
import unittest
from pathlib import Path
from journal_store import append, recover, read


class JournalRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.journal = Path(self.temp.name) / "race.jsonl"
        self.archive = Path(self.temp.name) / "race.json"
        self.template = {"schema_version": 1, "run": 1, "samples": [], "race_control": []}

    def test_recover_restart_without_duplicate(self):
        append(self.journal, {"type": "sample", "run": 1, "sample": {"lap": 1}})
        before = recover(self.journal, self.archive, self.template)
        after = recover(self.journal, self.archive, self.template)
        self.assertEqual(before["samples"], after["samples"])
        self.assertEqual(len(after["samples"]), 1)

    def test_rewind_preserves_prior_journal(self):
        append(self.journal, {"type": "sample", "run": 1, "sample": {"lap": 5}})
        append(self.journal, {"type": "run_start", "run": 2})
        append(self.journal, {"type": "sample", "run": 2, "sample": {"lap": 1}})
        state = recover(self.journal, self.archive, self.template)
        self.assertEqual(state["run"], 2)
        self.assertEqual(state["samples"], [{"lap": 1}])
        self.assertEqual(len(read(self.journal)), 3)

    def test_import_existing_archive(self):
        self.archive.write_text(json.dumps({"run": 3, "samples": [{"lap": 9}], "race_control": []}))
        state = recover(self.journal, self.archive, self.template)
        self.assertEqual(state["run"], 3)
        self.assertEqual(state["samples"], [{"lap": 9}])
        self.assertEqual(len(read(self.journal)), 2)
        recover(self.journal, self.archive, self.template)
        self.assertEqual(len(read(self.journal)), 2)

    def test_torn_final_line(self):
        append(self.journal, {"type": "sample", "run": 1, "sample": {"lap": 1}})
        with self.journal.open("ab") as handle:
            handle.write(b'{"type":"sample"')
        state = recover(self.journal, self.archive, self.template)
        self.assertEqual(len(state["samples"]), 1)
        self.assertTrue(self.journal.with_suffix(".jsonl.partial").exists())
        append(self.journal, {"type": "sample", "run": 1, "sample": {"lap": 2}})
        self.assertEqual(len(read(self.journal)), 2)

    def test_gps_geometry(self):
        template = {"schema_version": 1, "run": 1, "geometry": None, "samples": []}
        append(self.journal, {"type": "geometry", "run": 1, "geometry": {"points": [1, 2]}})
        append(self.journal, {"type": "sample", "run": 1, "sample": {"timestamp": 4}})
        state = recover(self.journal, self.archive, template, gps=True)
        self.assertEqual(state["geometry"]["points"], [1, 2])
        self.assertEqual(len(state["samples"]), 1)


if __name__ == "__main__":
    unittest.main()
