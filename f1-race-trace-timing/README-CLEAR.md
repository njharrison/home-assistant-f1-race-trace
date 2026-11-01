# Clear Race Data

Create a Home Assistant **Button helper**, e.g. `input_button.f1_clear_race_data`. In the add-on settings, specify a unique `recording_id` for the race/session and set `clear_button_entity` to the helper entity ID.

Add this dashboard button, replacing the example entity ID with your helper:

```yaml
type: button
name: Clear Race Data
icon: mdi:delete-clock-outline
tap_action:
  action: perform-action
  perform_action: input_button.press
  target:
    entity_id: input_button.f1_clear_race_data
  confirmation:
    text: Clear the selected race recording and start fresh? The previous journal will be retained in recordings-history.
```

When the helper is pressed after the add-on starts, the add-on stops both recorder processes, moves the selected recording directory to `recordings-history`, clears the four published compatibility JSON views, and starts the recorders again. No other event directory is changed. Existing history is retained indefinitely. The add-on ignores a button press that predates its startup.

The button is a manual dashboard configuration, not automatically installed by the add-on. A direct press of the Button helper outside this dashboard bypasses the dashboard confirmation.
