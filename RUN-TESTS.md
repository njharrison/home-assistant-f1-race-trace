# Test the Singapore Race Trace development branch

This branch contains the full recorded Singapore GPS fixture (`fixtures/singapore-data.js`), timing crossings, shared projection/reference/renderer modules, and numerical regression tests.

## GitHub Actions

Open **Actions → Race Trace regression** on this branch. The workflow runs `npm test` on pushes and pull requests. Its green check is the authoritative indication that the branch passes from a fresh GitHub checkout. The original production Home Assistant `dist/f1-race-trace.js` is unchanged.

## Local browser preview (optional)

```bash
npm install
npm run dev
```

Open the Vite address and visit `/dev/`. The page loads the same source files and Singapore fixture used by the tests.

## Local headless regression (no install needed)

```bash
npm test
```

## Known limitations

- The numerical golden master is not a pixel-perfect browser screenshot test.
- Circuit start/finish alignment and pit-lane exceptions still need generalisation before use for other races.
- The Home Assistant card has not yet been connected to this shared renderer.
