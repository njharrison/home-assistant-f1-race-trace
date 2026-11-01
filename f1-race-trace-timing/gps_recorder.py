"""Record F1 Sensor Track Map position snapshots independently of the dashboard.

Uses the integration's documented WebSocket snapshot subscription. This is
experimental acquisition only; the timing trace remains the default renderer.
"""
import json
import logging
import os
import time
from pathlib import Path

import websocket
from journal_store import append, recover, journal_path

# A quiet subscription is normal between sessions or while replay is paused.
# Reconnect only after an extended idle period, rather than on each socket timeout.
GPS_IDLE_RECONNECT_SECONDS = 120

LOG = logging.getLogger("f1-race-trace-gps")
OUTPUT = Path("/config/www/f1-race-trace/gps-recording.json")
DELTA_OUTPUT = OUTPUT.with_name("gps-recording-delta.json")
JOURNAL = OUTPUT.with_suffix(".jsonl")
DELTA_WINDOW_SECONDS = 180
TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")
WS_URL = "ws://supervisor/core/websocket"


def _write_atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(value, separators=(",", ":"), allow_nan=False))
    temporary.replace(path)


def _append_journal(value):
    append(JOURNAL, value)


def _save(document, full_archive=False):
    if full_archive:
        _write_atomic(OUTPUT, document)
    samples = document["samples"]
    cutoff = time.time() - DELTA_WINDOW_SECONDS
    start = next((i for i, sample in enumerate(samples)
                  if sample["recorded_at"] >= cutoff), len(samples))
    _write_atomic(DELTA_OUTPUT, {
        "schema_version": 1,
        "run": document["run"],
        "geometry": document["geometry"],
        "first_recorded_at": samples[0]["recorded_at"] if samples else None,
        "sample_start": start,
        "sample_count": len(samples),
        "samples": samples[start:],
    })


def record_gps(options):
    if not TOKEN:
        LOG.warning("No Supervisor token; GPS recording unavailable")
        return
    entry_id = str(options.get("track_map_entry_id") or "").strip()
    global JOURNAL
    JOURNAL = journal_path(OUTPUT, options)
    document = recover(JOURNAL, OUTPUT, {"schema_version": 1, "source": "F1 Sensor Track Map",
                "run": 1, "geometry": None, "samples": [],
                "recorded_at_clock": "unix_epoch_utc",
                "timestamp_clock": "f1_session"}, gps=True)
    previous_time = document["samples"][-1]["timestamp"] if document["samples"] else None
    previous_signature = None
    last_write = 0.0
    last_archive_write = 0.0
    while True:
        ws = None
        try:
            ws = websocket.create_connection(WS_URL, timeout=15)
            hello = json.loads(ws.recv())
            if hello.get("type") != "auth_required":
                raise RuntimeError("Unexpected Home Assistant WebSocket handshake")
            ws.send(json.dumps({"type": "auth", "access_token": TOKEN}))
            auth = json.loads(ws.recv())
            if auth.get("type") != "auth_ok":
                raise RuntimeError("Track Map WebSocket authentication failed")
            command = {"id": 1, "type": "f1_sensor/track_map/subscribe",
                       "throttle_ms": 500, "protocol_version": 1}
            if entry_id:
                command["entry_id"] = entry_id
            ws.send(json.dumps(command))
            LOG.info("Track Map GPS subscription requested")
            last_message_at = time.monotonic()
            while True:
                try:
                    raw_message = ws.recv()
                except websocket.WebSocketTimeoutException:
                    idle_seconds = time.monotonic() - last_message_at
                    if idle_seconds >= GPS_IDLE_RECONNECT_SECONDS:
                        raise TimeoutError(
                            f"Track Map stream silent for {idle_seconds:.0f}s; reconnecting"
                        )
                    continue
                last_message_at = time.monotonic()
                received_at = round(time.time(), 3)
                message = json.loads(raw_message)
                if message.get("type") == "result" and not message.get("success", True):
                    raise RuntimeError("Track Map subscription: " + str(message.get("error")))
                if message.get("type") != "event" or message.get("id") != 1:
                    continue
                event = message.get("event") or {}
                snapshot = event.get("snapshot") or {}
                if not isinstance(snapshot, dict):
                    continue
                drivers = snapshot.get("drivers") or []
                timestamp = snapshot.get("position_timestamp") or snapshot.get("stream_timestamp")
                if not timestamp or not isinstance(drivers, list) or not drivers:
                    continue
                from datetime import datetime
                try:
                    instant = datetime.fromisoformat(timestamp.replace("Z", "+00:00")).timestamp()
                except (TypeError, ValueError):
                    continue
                if previous_time is not None and instant < previous_time - 5:
                    document = {"schema_version": 1, "source": "F1 Sensor Track Map",
                                "run": document["run"] + 1, "geometry": None, "samples": [],
                                "recorded_at_clock": "unix_epoch_utc",
                                "timestamp_clock": "f1_session"}
                    previous_signature = None
                    _append_journal({"type": "run_start", "run": document["run"]})
                    LOG.info("GPS replay rewind: run %s", document["run"])
                previous_time = instant
                track = snapshot.get("track")
                if track and track != document["geometry"]:
                    document["geometry"] = track
                    _append_journal({"type": "geometry", "run": document["run"], "geometry": track})
                compact = []
                for driver in drivers:
                    if not isinstance(driver, dict):
                        continue
                    x, y = driver.get("x"), driver.get("y")
                    if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
                        continue
                    compact.append({
                        "id": str(driver.get("racing_number") or ""),
                        "x": x, "y": y, "status": driver.get("status"),
                        "timestamp": driver.get("timestamp"),
                        "pit_lane": driver.get("pit_lane"),
                    })
                if not compact:
                    continue
                signature = json.dumps([instant, compact], sort_keys=True)
                if signature != previous_signature:
                    document["samples"].append({
                        "timestamp": instant,  # Original race/session time (legacy field).
                        "recorded_at": received_at,  # HA wall clock, shared with timing recorder.
                        "replay_state": snapshot.get("replay_state"),
                        "stream_timestamp": snapshot.get("stream_timestamp"),
                        "position_timestamp": snapshot.get("position_timestamp"),
                        "drivers": compact,
                    })
                    previous_signature = signature
                    _append_journal({"type": "sample", "run": document["run"], "sample": document["samples"][-1]})
                now_monotonic = time.monotonic()
                if now_monotonic - last_write >= 2:
                    _save(document, full_archive=now_monotonic - last_archive_write >= 30)
                    if now_monotonic - last_archive_write >= 30:
                        last_archive_write = now_monotonic
                    last_write = now_monotonic
        except Exception:
            LOG.exception("Track Map stream unavailable; retrying in 10 seconds")
        finally:
            if ws is not None:
                ws.close()
        time.sleep(10)
