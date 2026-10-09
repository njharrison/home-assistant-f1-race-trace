"""One-shot FastF1 lap exporter and Home Assistant archive publisher."""
import json
import logging
from pathlib import Path
import fastf1

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
root = Path("/share/f1-race-trace")
root.mkdir(parents=True, exist_ok=True)
cache = root / "fastf1-cache"
cache.mkdir(exist_ok=True)
fastf1.Cache.enable_cache(str(cache))
options = json.loads(Path("/data/options.json").read_text())
year, event, session_type = int(options["year"]), options["event"], options["session"]
logging.info("Loading %s %s %s", year, event, session_type)
session = fastf1.get_session(year, event, session_type)
session.load(laps=True, telemetry=False, weather=False, messages=True)

def seconds(value):
    try:
        import pandas as pd
        return None if pd.isna(value) else round(value.total_seconds(), 3)
    except (TypeError, ValueError, AttributeError):
        return None

def safe(value):
    import pandas as pd
    try:
        return None if pd.isna(value) else str(value)
    except (TypeError, ValueError):
        return str(value)

laps = []
for _, row in session.laps.iterrows():
    number = safe(row.get("LapNumber"))
    if number is None:
        continue
    pos = safe(row.get("Position"))
    laps.append({
        "driver": safe(row.get("Driver")),
        "driver_number": safe(row.get("DriverNumber")),
        "lap": int(float(number)),
        "lap_time_seconds": seconds(row.get("LapTime")),
        "sector_1_seconds": seconds(row.get("Sector1Time")),
        "sector_2_seconds": seconds(row.get("Sector2Time")),
        "sector_3_seconds": seconds(row.get("Sector3Time")),
        "sector_1_session_seconds": seconds(row.get("Sector1SessionTime")),
        "sector_2_session_seconds": seconds(row.get("Sector2SessionTime")),
        "sector_3_session_seconds": seconds(row.get("Sector3SessionTime")),
        "lap_end_session_seconds": seconds(row.get("Time")),
        "pit_in_session_seconds": seconds(row.get("PitInTime")),
        "pit_out_session_seconds": seconds(row.get("PitOutTime")),
        "compound": safe(row.get("Compound")),
        "position": int(float(pos)) if pos is not None else None,
    })
result = {"schema_version": 1, "source": "FastF1", "year": year,
          "event": event, "session": session_type,
          "time_reference": "seconds since FastF1 session origin",
          "laps": laps,
          "note": "Lap-end timestamps are not simultaneous gap measurements."}
output = root / f"{year}-{str(event).lower().replace(' ', '-')}-{session_type.lower()}.json"
temp = output.with_suffix(".json.tmp")
temp.write_text(json.dumps(result, separators=(",", ":"), allow_nan=False))
temp.replace(output)
logging.info("Exported %d laps to %s", len(laps), output)

# Publish a browser-readable copy for the Lovelace card. /share is not
# available via Home Assistant's /local/ URL; /config/www is.
web_root = Path("/config/www/f1-race-trace")
web_root.mkdir(parents=True, exist_ok=True)
web_output = web_root / output.name
web_temp = web_output.with_suffix(".json.tmp")
web_temp.write_text(json.dumps(result, separators=(",", ":"), allow_nan=False))
web_temp.replace(web_output)
logging.info("Published archive at /local/f1-race-trace/%s", output.name)
