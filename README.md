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
