# Crash-safe race recording and explicit deletion

Status: design requirements for draft PR #3; not implemented or released.

## Invariants

1. A restart, crash, lost Supervisor connection, or add-on upgrade must not truncate existing journals or overwrite a prior race/run.
2. A replay rewind starts a new run ID, preserving earlier runs.
3. Recordings are keyed by event identity (year, event, session) and a unique run ID. Switching events must not overwrite old data.
4. Each sample and control event is appended to a journal before it is considered durable. A restart recovers the journal, ignoring only an incomplete final line. Recovery must be idempotent.
5. The existing `live-recording.json`, `gps-recording.json` and delta JSON files are derived compatibility views, not authoritative storage. Do not overwrite them with empty documents on startup.
6. Crash recovery must handle timing and GPS streams independently, including one recorder restarting while the other remains active.
7. Retention is unlimited by default; no automatic deletion or rollover may destroy historical runs.

## Clear Race Data UI

Provide a Home Assistant action/button labelled **Clear Race Data**. It must show the exact selected event and run(s), and require an explicit confirmation. Deletion should target only the selected event/run, never all recorded events implicitly. Stop/rotate active writers before deleting, and remove derived JSON views for that selection. Expose the action only after testing its permissions and confirmation flow.

## Migration and tests

- Import pre-existing full JSON archives into journals without overwriting originals.
- Restart after a partial journal line; verify all earlier samples survive.
- Restart after a complete line; verify no duplicate events or lost samples.
- Rewind during replay; verify previous run remains available.
- Change event selection; verify both events survive.
- Test concurrent timing/GPS writes and restart during compatibility view generation.
- Verify both existing Lovelace cards can recover current-run data from compatibility views.
- Test Clear Race Data with confirmation, wrong selection, and interrupted deletion.

Do not merge the append-only prototype until recovery and retention invariants are implemented and tested.
