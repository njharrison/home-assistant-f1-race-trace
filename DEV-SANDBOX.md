# Race Trace development sandbox

This branch is reserved for integrating the validated Suzuka offline Race Trace into the Home Assistant card. **Do not change the production card until the new renderer is verified.**

The extracted local sandbox is provided separately as `f1-race-trace-dev.zip`. It contains `baseline.html`, `dev/index.html`, `fixtures/suzuka-data.js`, `src/race-trace.js`, and `package.json`.

To test locally, extract the ZIP, run `npm install` and `npm run dev`, and open `/dev/` in the displayed local server. Changes to `src/race-trace.js` will refresh the browser.

Next: verify identical output, split the engine into reusable modules, add projection regression tests, and wire the existing HA card to the shared renderer. The current HA card remains untouched.
