"""Append-only recording journals and crash recovery.

Each complete newline is an independently recoverable record. A torn final
line is preserved in a quarantine file before appending again.
"""
import json
import os
from pathlib import Path


def append(path, entry):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = (json.dumps(entry, separators=(",", ":"), allow_nan=False) + "\n").encode()
    with path.open("ab") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())


def read(path):
    path = Path(path)
    if not path.exists():
        return []
    raw = path.read_bytes()
    lines = raw.split(b"\n")
    if lines[-1]:
        # Preserve a torn trailing record, then remove it from the active file.
        torn = lines.pop()
        quarantine = path.with_suffix(path.suffix + ".partial")
        with quarantine.open("ab") as handle:
            handle.write(torn + b"\n")
        with path.open("wb") as handle:
            handle.write(b"\n".join(lines) + b"\n")
    result = []
    for line in lines:
        if not line:
            continue
        try:
            result.append(json.loads(line))
        except (ValueError, UnicodeDecodeError):
            # Keep the raw journal for manual investigation; never delete it.
            raise ValueError(f"Corrupt complete journal record: {path}")
    return result


def recover(path, archive, template, gps=False):
    path, archive = Path(path), Path(archive)
    if not path.exists() and archive.exists():
        # Import the previous complete archive before any new writes.
        previous = json.loads(archive.read_text())
        if isinstance(previous, dict) and isinstance(previous.get("samples"), list):
            append(path, {"type": "run_start", "run": previous.get("run", 1)})
            if gps and previous.get("geometry") is not None:
                append(path, {"type": "geometry", "run": previous.get("run", 1),
                              "geometry": previous["geometry"]})
            for sample in previous["samples"]:
                append(path, {"type": "sample", "run": previous.get("run", 1),
                              "sample": sample})
            for event in previous.get("race_control", []):
                append(path, {"type": "race_control", "run": previous.get("run", 1),
                              "event": event})
    document = dict(template)
    document["samples"] = []
    if not gps:
        document["race_control"] = []
    for row in read(path):
        kind = row.get("type")
        run = row.get("run", 1)
        if kind == "run_start" or run != document["run"]:
            document = dict(template)
            document["run"] = run
            document["samples"] = []
            if not gps:
                document["race_control"] = []
        if kind == "geometry" and gps:
            document["geometry"] = row["geometry"]
        elif kind == "sample":
            document["samples"].append(row["sample"])
        elif kind == "race_control" and not gps:
            document["race_control"].append(row["event"])
    return document
