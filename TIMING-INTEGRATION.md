# Timing-based lap alignment

The 2026 Singapore timing recording contains 378 completed-lap transitions. Its 22 first `completed_laps` 1→2 transitions match the previously hard-coded per-driver anchors to two decimal places. `src/timing-alignment.js` derives these anchors from `[driverId,completedLaps,secondsSinceRecordingStart]` events; `tests/timing-alignment.test.js` checks rounding and first-transition behaviour.

In the local development sandbox, the timing stream was extracted into `fixtures/singapore-timing.js`, and `src/race-trace.js` was modified to consume `RaceTraceTiming.lapTwoAnchors((globalThis.RaceTraceTimingSource || TIMING).lapCrossings)`. The full Singapore regression suite passed **7/7**, including the existing golden master. These local files and the large recorded GPS fixture have **not yet been transferred to this GitHub branch**. Do not consider this branch a runnable standalone project yet.

The existing projection still uses a fixed start/finish point and a special pit-lane exception for car 63. The timing anchors are data-derived, but the full algorithm is not yet circuit-independent.

Next: transfer the existing validated source and fixture into this branch, rerun the golden master from a GitHub checkout, then generalise start/finish and pit-lane handling before integrating with the HA card. Production `dist/f1-race-trace.js` remains untouched.
