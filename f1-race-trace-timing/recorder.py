"""Persist live F1 sensor gap samples while the dashboard is closed.

Uses the Supervisor's authenticated Home Assistant REST proxy. A race replay
rewind starts a new recording; snapshots are stored as atomic JSON documents.
"""
import json
import logging
import os
import time
from pathlib import Path

import requests

LOG = logging.getLogger("f1-race-trace-recorder")
OUTPUT = Path("/config/www/f1-race-trace/live-recording.json")
API = "http://supervisor/core/api/states/"
TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")


def get_state(session, entity):
    response = session.get(API + entity, timeout=8)
    response.raise_for_status()
    return response.json()


def write_atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".json.tmp")
    temp.write_text(json.dumps(value, separators=(",", ":"), allow_nan=False))
    temp.replace(path)


def record(options):
    if not TOKEN:
        LOG.error("SUPERVISOR_TOKEN unavailable; live recorder disabled")
        return
    driver_entity = options.get("driver_entity", "sensor.f1_drivers_driver_positions")
    lap_entity = options.get("lap_entity", "sensor.f1_race_lap_count")
    session = requests.Session()
    session.headers.update({"Authorization": "Bearer " + TOKEN})
    recording = {"schema_version": 1, "source": "F1 Sensor", "run": 1, "samples": []}
    last_lap = None
    last_signature = None
    last_write = 0
    LOG.info("Recording %s and %s to %s", driver_entity, lap_entity, OUTPUT)
    while True:
        try:
            driver_state = get_state(session, driver_entity)
            lap_state = get_state(session, lap_entity)
            lap = int(float(lap_state.get("state", "0")))
            if last_lap is not None and lap < last_lap:
                recording = {"schema_version": 1, "source": "F1 Sensor",
                             "run": recording["run"] + 1, "samples": []}
                last_signature = None
                LOG.info("Replay rewind detected; starting recording run %s", recording["run"])
            last_lap = lap
            drivers = driver_state.get("attributes", {}).get("drivers", [])
            if not isinstance(drivers, list):
                drivers = []
            compact = []
            for d in drivers:
                compact.append({
                    "id": str(d.get("racing_number") or d.get("tla") or ""),
                    "tla": d.get("tla"),
                    "gap": d.get("gap_to_leader"),
                    "position": d.get("current_position"),
                    "completed_laps": d.get("completed_laps"),
                    "sector_state": d.get("sector_state"),
                    "sector_current_lap": d.get("sector_current_lap"),
                    "sector_1": d.get("sector_1"),
                    "sector_2": d.get("sector_2"),
                    "sector_3": d.get("sector_3"),
                    "sector_1_lap": d.get("sector_1_lap"),
                    "sector_2_lap": d.get("sector_2_lap"),
                    "sector_3_lap": d.get("sector_3_lap"),
                })
            signature = json.dumps([lap, compact], sort_keys=True)
            now = time.time()
            if signature != last_signature:
                recording["samples"].append({"timestamp": round(now, 3),
                                              "lap": lap, "drivers": compact})
                last_signature = signature
            if now - last_write >= 2:
                write_atomic(OUTPUT, recording)
                last_write = now
        except (requests.RequestException, ValueError, TypeError, OSError) as exc:
            LOG.warning("Live recorder retrying: %s", exc)
        time.sleep(1)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    record(json.loads(Path("/data/options.json").read_text()))
