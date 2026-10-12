"""Start live recording independently of the optional FastF1 export."""
import json
import logging
import subprocess
import sys
import threading
from pathlib import Path

logging.basicConfig(level=logging.INFO)
options = json.loads(Path("/data/options.json").read_text())
if options.get("record_live", True):
    from recorder import record
    threading.Thread(target=record, args=(options,), daemon=True).start()

if options.get("record_gps", False):
    from gps_recorder import record_gps
    threading.Thread(target=record_gps, args=(options,), daemon=True).start()

# Export the archive once without stopping the recorder if FastF1 fails.
try:
    subprocess.run([sys.executable, "/run.py"], check=True)
except Exception:
    logging.exception("Archive export failed; live recorder will continue")

if options.get("record_live", True) or options.get("record_gps", False):
    threading.Event().wait()
