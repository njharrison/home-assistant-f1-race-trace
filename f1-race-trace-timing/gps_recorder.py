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

LOG = logging.getLogger("f1-race-trace-gps")
OUTPUT = Path("/config/www/f1-race-trace/gps-recording.json")
TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")
WS_URL = "ws://supervisor/core/websocket"


def _save(document):
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(document, separators=(",", ":"), allow_nan=False))
    temporary.replace(OUTPUT)


def record_gps(options):
    if not TOKEN:
        LOG.warning("No Supervisor token; GPS recording unavailable")
        return
    entry_id = str(options.get("track_map_entry_id") or "").strip()
    document = {"schema_version": 1, "source": "F1 Sensor Track Map",
                "run": 1, "geometry": None, "samples": []}
    previous_time = None
    previous_signature = None
    last_write = 0.0
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
            while True:
                message = json.loads(ws.recv())
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
                                "run": document["run"] + 1, "geometry": None, "samples": []}
                    previous_signature = None
                    LOG.info("GPS replay rewind: run %s", document["run"])
                previous_time = instant
                track = snapshot.get("track")
                if track and track != document["geometry"]:
                    document["geometry"] = track
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
                    document["samples"].append({"timestamp": instant, "drivers": compact})
                    previous_signature = signature
                if time.monotonic() - last_write >= 2:
                    _save(document)
                    last_write = time.monotonic()
        except Exception:
            LOG.exception("Track Map stream unavailable; retrying in 10 seconds")
        finally:
            if ws is not None:
                ws.close()
        time.sleep(10)
