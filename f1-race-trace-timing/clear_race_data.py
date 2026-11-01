"""Explicit, offline deletion of a selected recording's journals.

The command refuses to delete while the recorder is running. It does not
remove legacy archives or public compatibility views automatically.
"""
import argparse
import shutil
import sys
from pathlib import Path
from journal_store import recording_key

ROOT = Path("/config/www/f1-race-trace/recordings")


def clear_recording(root, recording_id, confirmation, recorder_running=False):
    key = recording_key({"recording_id": recording_id})
    if key == "unassigned":
        raise ValueError("Specify a named recording; cannot clear unassigned")
    if confirmation != f"CLEAR {key}":
        raise ValueError(f"Confirmation must be exactly: CLEAR {key}")
    if recorder_running:
        raise RuntimeError("Stop the F1 Race Trace Timing add-on before clearing")
    target = Path(root) / key
    if not target.is_dir() or target.is_symlink():
        raise FileNotFoundError(f"No recording directory: {key}")
    shutil.rmtree(target)
    return key


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--recording-id", required=True)
    parser.add_argument("--confirm", required=True)
    args = parser.parse_args()
    # Only safe to run offline. The add-on container itself always has active
    # recorder threads; this CLI is for maintenance with the add-on stopped.
    print("Offline maintenance only: stop the add-on first.", file=sys.stderr)
    raise SystemExit(2)


if __name__ == "__main__":
    main()
