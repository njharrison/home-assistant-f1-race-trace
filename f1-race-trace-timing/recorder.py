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
DELTA_OUTPUT = OUTPUT.with_name("live-recording-delta.json")
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
    race_control_entity = options.get("race_control_entity", "sensor.f1_officials_race_control")
    track_status_entity = options.get("track_status_entity", "sensor.f1_track_status")
    session = requests.Session()
    session.headers.update({"Authorization": "Bearer " + TOKEN})
    recording = {"schema_version": 1, "source": "F1 Sensor", "run": 1, "samples": [], "race_control": []}
    seen_control = set()
    last_lap = None
    last_signature = None
    last_write = 0
    # Keep a rolling window, not just the last batch: a browser can miss polls.
    delta_window_seconds = 90
    LOG.info("Recording %s and %s to %s", driver_entity, lap_entity, OUTPUT)
    while True:
        try:
            driver_state = get_state(session, driver_entity)
            lap_state = get_state(session, lap_entity)
            lap_value = lap_state.get("state")
            try:
                lap = int(float(lap_value))
            except (ValueError, TypeError, OverflowError):
                # Unavailable between sessions: wait without logging or resetting.
                time.sleep(1)
                continue
            if lap < 1:
                time.sleep(1)
                continue
            if last_lap is not None and lap < last_lap:
                recording = {"schema_version": 1, "source": "F1 Sensor",
                             "run": recording["run"] + 1, "samples": [], "race_control": []}
                last_signature = None
                seen_control.clear()
                LOG.info("Replay rewind detected; starting recording run %s", recording["run"])
            last_lap = lap
            # F1 Sensor exposes the latest FIA message and a short history.
            # Capture each event once, even if it is first seen in history.
            try:
                control = get_state(session, race_control_entity)
                attrs = control.get("attributes") or {}
                events = list(reversed(attrs.get("history") or []))
                if attrs.get("event_id"):
                    events.append(attrs)
                for event in events:
                    if not isinstance(event, dict):
                        continue
                    event_id = event.get("event_id")
                    if not event_id or event_id in seen_control:
                        continue
                    seen_control.add(event_id)
                    recording["race_control"].append({
                        "event_id": event_id,
                        "observed_at": round(time.time(), 3),
                        "lap": lap,
                        "utc": event.get("utc"),
                        "category": event.get("category"),
                        "flag": event.get("flag"),
                        "message": event.get("message"),
                    })
            except (requests.RequestException, ValueError, TypeError) as exc:
                LOG.debug("Race control unavailable (%s): %s", race_control_entity, exc)
            drivers = driver_state.get("attributes", {}).get("drivers", [])
            if not isinstance(drivers, list):
                drivers = []
            compact = []
            for d in drivers:
                compact.append({
                    "id": str(d.get("racing_number") or d.get("tla") or ""),
                    "tla": d.get("tla"),
                    "gap": d.get("gap_to_leader"),
                    "status": d.get("status") or d.get("driver_status") or d.get("race_status"),
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
            # Track status is part of the recorded sample stream: a status
            # transition must be persisted even when no driver gaps change.
            track_status = None
            try:
                track_status = str(get_state(session, track_status_entity).get("state") or "").upper()
            except (requests.RequestException, ValueError, TypeError) as exc:
                LOG.debug("Track status unavailable (%s): %s", track_status_entity, exc)
            signature = json.dumps([lap, compact, track_status], sort_keys=True)
            now = time.time()
            if signature != last_signature:
                recording["samples"].append({"timestamp": round(now, 3),
                                              "lap": lap, "drivers": compact,
                                              "track_status": track_status})
                last_signature = signature
            if now - last_write >= 2:
                write_atomic(OUTPUT, recording)
                samples = recording["samples"]
                events = recording["race_control"]
                sample_start = next((i for i, row in enumerate(samples)
                                     if row["timestamp"] >= now - delta_window_seconds),
                                    len(samples))
                event_start = next((i for i, row in enumerate(events)
                                    if row["observed_at"] >= now - delta_window_seconds),
                                   len(events))
                write_atomic(DELTA_OUTPUT, {
                    "schema_version": 1, "run": recording["run"],
                    "sample_start": sample_start, "sample_count": len(samples),
                    "samples": samples[sample_start:],
                    "event_start": event_start, "event_count": len(events),
                    "race_control": events[event_start:],
                })
                last_write = now
        except (requests.RequestException, ValueError, TypeError, OSError) as exc:
            LOG.warning("Live recorder retrying: %s", exc)
        time.sleep(1)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    record(json.loads(Path("/data/options.json").read_text()))
