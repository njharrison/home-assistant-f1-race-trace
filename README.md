# F1 Race Trace — Singapore development sandbox

This development branch contains the recorded **2026 Singapore Grand Prix** GPS/timing fixture, the extracted offline Race Trace engine, numerical regression tests and the preserved visual baseline. It does **not** replace the production Home Assistant card.

## Test the calculations

Requires Node.js 22 or later; no npm installation needed:

```sh
npm test
```

The seven tests cover GPS projection continuity, reference-profile behaviour, retirement handling, timing-derived lap anchors, data-source validation, and the **22-driver Singapore numerical golden master**. A failure in the golden-master test indicates the calculated trace changed. Inspect differences before intentionally updating the baseline.

The timing-based lap anchors are derived from `fixtures/singapore-timing.js`. They reproduce all 22 original hard-coded Singapore lap-two anchors. The current geometry still includes circuit-specific start/finish calibration and a special pit-lane exception for car 63; these need generalising before live use at other circuits.

## Local visual preview

```sh
npm install
npm run dev
```

Open the Vite URL and visit `/dev/` if needed. `dev/index.html` loads the shared source files in order. Compare the preview with `baseline.html`, the preserved known-good offline version. **Pixel-perfect rendering has not been automatically verified.**

## Project structure

- `src/gps-projection.js`: trajectory-normal and nearest-segment GPS projection
- `src/reference-profile.js`: reference-pace calculations
- `src/race-trace.js`: race state, lap alignment and progress
- `src/renderer.js`: chart drawing and controls
- `src/data-source.js`: framework-independent GPS snapshot input
- `src/timing-alignment.js`: completed-lap transition anchors
- `fixtures/singapore-data.js`: recorded Singapore GPS positions and centreline
- `fixtures/singapore-timing.js`: recorded Singapore timing transitions
- `tests/singapore-regression.test.js`: offline regression suite
- `tests/timing-alignment.test.js`: standalone timing unit tests
- `golden/singapore-traces.json`: numerical reference traces
- `baseline.html`: original validated visual preview

## Integration status

This is a browser preview and test harness, **not yet a Home Assistant card build**. The existing production `dist/f1-race-trace.js` remains unchanged. Next: generalise circuit start/finish and pit handling, then build a thin HA adapter that feeds the same renderer with live GPS and timing data.

The Singapore fixture's existing coordinates and track key were preserved unchanged; no replacement geometry was introduced.
