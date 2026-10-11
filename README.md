# F1 Race Trace for Home Assistant

Full-screen F1 timing visualisation and historical FastF1 timing exporter for Home Assistant OS.

> Early development prototype. The chart and timing exporter are not yet connected; historical gaps are not yet fully reconstructed.

## Components

- `dist/f1-race-trace.js`: custom Lovelace Race Trace card (in development)
- `f1-race-trace-timing/`: Home Assistant OS local app exporting archived lap timing from FastF1

## Roadmap

- Historical lap-by-lap trace independent of replay seeking
- Accurate gap alignment and explicit estimates
- Driver selection, labels, pit stops, SC/VSC periods
- HACS card distribution and Home Assistant app repository installation

## Existing dashboard card configuration

```yaml
type: custom:f1-race-trace
entity: sensor.f1_drivers_driver_positions
lap_entity: sensor.f1_race_lap_count
height: 85vh
```

This project is independent of [Nicxe/f1_sensor](https://github.com/Nicxe/f1_sensor).

## Persistent live recording (add-on v0.3.0)

The F1 Race Trace Timing add-on now runs a background recorder independently of
the Lovelace card. Install/rebuild the updated local add-on, set
`record_live: true`, and **start** the add-on. Its boot mode is automatic.

It polls the Home Assistant F1 driver and lap sensors using the Supervisor
API, saving timestamped gaps and sector state changes atomically to
`/config/www/f1-race-trace/live-recording.json`. The file is accessible at
`/local/f1-race-trace/live-recording.json`.

The card automatically reloads this recording every five seconds while open,
restoring observations collected while it was closed. You may override the URL:

```yaml
type: custom:f1-race-trace
entity: sensor.f1_drivers_driver_positions
lap_entity: sensor.f1_race_lap_count
recording_url: /local/f1-race-trace/live-recording.json
```

Set `recording_url: false` to disable retrieval. The legacy timing engine
does not consume recorded gap observations.

**Caveats:** Replay rewind (a decreasing lap counter) starts a fresh recording;
it overwrites the previous run's live file. The recorder captures changes seen
by the Home Assistant sensor, not the original sub-second F1 feed. Its storage
is an accumulating JSON document, so long sessions may grow large. The archive
exporter is still a separate, one-time FastF1 operation.


## Experimental shared pace and lapped-car wrapping

The default live `AVERAGE` view now positions drivers against a common
cumulative reference-lap baseline; observed gaps determine their separation.
The timing recorder's timestamped samples are used when the card reopens.
A lapped trace can be displayed one reference lap higher, as a dotted,
disconnected path, without altering its original data.

```yaml
type: custom:f1-race-trace
entity: sensor.f1_drivers_driver_positions
lap_entity: sensor.f1_race_lap_count
wrap_lapped: true  # default; set false to disable
```

This is experimental: a reference-lap-sized gap is an approximation of lap
status, not definitive lap-down detection. Leader changes during pit cycles
and SC/VSC periods require replay validation. `timing_engine: legacy` remains
available as a fallback.

## FIA Safety Car / Virtual Safety Car recording (add-on v0.3.4)

The recorder also polls Nicxe F1 Sensor's `sensor.f1_race_control`
(configurable as `race_control_entity` in add-on options), deduplicates
race-control messages using their event IDs, and saves them under
`race_control` in the existing `live-recording.json`. The card displays
recorded SC and VSC periods as shaded regions. Existing recordings without
race-control events remain compatible.

**Installation:** Update the timing add-on to v0.3.4 and rebuild/restart it.
Refresh the Lovelace card's JavaScript resource to the latest commit.
New events are recorded from then onward; earlier replay history cannot be
recovered from the existing driver-only recording. Replay rewind resets the
event list. Nicxe's sensor only exposes its latest five messages, so the
recorder should remain running to avoid missing older events.

## Incremental recording downloads (add-on v0.3.5)

The recorder continues writing the complete `live-recording.json` archive.
It additionally publishes `live-recording-delta.json` with a rolling
90-second window of samples and FIA race-control events, plus their absolute
array offsets. The card downloads the full archive on first load, then
polls the much smaller delta every five seconds. If the delta is missing,
stale, belongs to another replay run, or no longer covers the samples the
browser missed, the card automatically reloads the full archive. The
existing full archive format remains compatible.

Upgrade/rebuild/restart the timing add-on to **v0.3.5** and refresh the
Lovelace card's JS resource. A custom `recording_url` automatically maps
`name.json` to `name-delta.json`; use `recording_delta_url` to override.
This reduces network transfer and JSON parsing; complete trace reconstruction
is still performed when new data arrives.
