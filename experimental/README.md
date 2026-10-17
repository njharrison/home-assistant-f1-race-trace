# Experimental Home Assistant card

This is an **isolated prototype**, not a replacement for `dist/f1-race-trace.js`.
It currently renders distance against recording time, **not** the browser preview's corrected race-gap trace.

## Install alongside production

Copy the following files from the `dev/shared-race-trace-engine` branch into your Home Assistant `/config/www/f1-race-trace-experimental/` directory, retaining the folder structure:

- `experimental/f1-race-trace-experimental.js`
- `src/circuit-alignment.js`
- `src/recording-sync.js`
- `src/start-finish-calibration.js`
- `src/official-alignment.js`

The resource is a JavaScript module at:
`/local/f1-race-trace-experimental/experimental/f1-race-trace-experimental.js?v=1`.

In **Settings → Dashboards → Resources**, add this resource as **JavaScript module**.
Then add a manual card:

```yaml
type: custom:f1-race-trace-experimental
gps_url: /local/f1-race-trace/gps-recording.json
timing_url: /local/f1-race-trace/live-recording.json
height: 460
```

The GPS URL must serve a schema-version-1 GPS recording with `geometry.points`, `samples[].recorded_at`, and driver coordinates. The timing URL must serve schema-version-1 timing samples with `timestamp` and `completed_laps`. Both must be from the same session.

The URLs above are examples, **not proof** that your recorder publishes GPS at that path. Set the actual GPS recorder URL.

This prototype polls both complete files every five seconds, which is inefficient for long races. Avoid leaving it running continuously until incremental updates are implemented. It also uses simple centreline projection; it is not yet the trajectory-normal projection of the approved Singapore browser preview.

Do not publish private recordings or credentials in a public GitHub repository. Home Assistant's `/local/` assets are served without authentication.
