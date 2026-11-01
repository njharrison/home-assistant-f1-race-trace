"""Run independent recorder processes and coordinate confirmed data reset."""
import json
import logging
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
import requests
from journal_store import recording_key

logging.basicConfig(level=logging.INFO)
LOG = logging.getLogger("f1-race-trace-supervisor")
WEB_ROOT = Path("/config/www/f1-race-trace")
API = "http://supervisor/core/api/states/"


def start_workers(options):
    programs = []
    if options.get("record_live", True):
        programs.append("/recorder.py")
    if options.get("record_gps", False):
        programs.append("/gps_recorder.py")
    return [subprocess.Popen([sys.executable, name]) for name in programs]


def stop_workers(processes):
    for process in processes:
        if process.poll() is None:
            process.terminate()
    for process in processes:
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def clear_selected_recording(options):
    """Move selected journals into protected history before restarting."""
    key = recording_key(options)
    if key == "unassigned":
        raise ValueError("Cannot clear an unnamed recording")
    target = WEB_ROOT / "recordings" / key
    if not target.exists():
        return
    if not target.is_dir() or target.is_symlink():
        raise ValueError("Invalid recording directory")
    history = WEB_ROOT / "recordings-history"
    history.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    target.rename(history / (key + "-" + timestamp))
    LOG.warning("Cleared active recording %s; previous journal preserved in history", key)


def button_revision(session, entity):
    response = session.get(API + entity, timeout=8)
    response.raise_for_status()
    state = response.json()
    if state.get("entity_id") != entity:
        raise ValueError("Unexpected clear button entity")
    return state.get("last_changed")


def main():
    options = json.loads(Path("/data/options.json").read_text())
    processes = start_workers(options)
    if options.get("export_archive", False):
        try:
            subprocess.run([sys.executable, "/run.py"], check=True)
        except Exception:
            LOG.exception("Optional FastF1 export failed")
    entity = str(options.get("clear_button_entity") or "").strip()
    if entity and not entity.startswith("input_button."):
        raise ValueError("clear_button_entity must be an input_button")
    session = requests.Session()
    session.headers.update({"Authorization": "Bearer " + os.environ.get("SUPERVISOR_TOKEN", "")})
    baseline = None
    try:
        while True:
            time.sleep(2)
            if not entity:
                continue
            try:
                revision = button_revision(session, entity)
                if baseline is None:
                    baseline = revision
                    continue
                if revision == baseline:
                    continue
                baseline = revision
                stop_workers(processes)
                processes = []
                try:
                    clear_selected_recording(options)
                finally:
                    processes = start_workers(options)
            except (requests.RequestException, ValueError, OSError):
                LOG.exception("Clear button operation failed")
    finally:
        stop_workers(processes)


if __name__ == "__main__":
    main()
