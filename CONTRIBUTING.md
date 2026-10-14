# Contributing

Thanks for helping. Every merged change ships to real drivers' dashboards, so the bar is simple: **show that the decode is right on a real car.**

## Reporting a wrong reading

You don't need to know anything about CAN to help. [Open an issue](../../issues/new/choose) that says what the app shows, what it should show, and how you know (the cluster, an OBD-II scanner, a gauge). If you have a KDMLink, attach a recording from **Settings → CAN Bus Recorder** taken while the problem was happening. That is usually enough for someone to find the fix.

## Changing or adding a signal

1. **Capture.** Record the bus during a drive that covers the signal's full range: cold and hot, idle and WOT, every gear, full and low fuel, whatever applies. A KDMLink recording, a `candump` log or a SavvyCAN export all work.
2. **Get a reference.** Log the same quantity from something trustworthy at the same time (an OBD-II scanner, the cluster, a wideband, a dyno), or use a known physical state ("tank was just filled", "car in 3rd").
3. **Edit the JSON.** See [docs/FORMAT.md](docs/FORMAT.md). Put the change in the most specific layer that is true. Only put it in `common.json` if it holds for every car listed in the manifest.
4. **Check it:**
   ```bash
   node scripts/decode.mjs hyundai.elantra_n.2022-2026.dct my_drive.csv --signals FuelLevel
   node scripts/validate.mjs
   ```
5. **Re-check the reference captures:** `node scripts/check-captures.mjs`. If your change intentionally alters decoded values, run it with `--update` and say in the PR which values moved and why.
6. **Bump the version** in every affected leaf and add a sentence to its `notes` (see [Versioning](docs/FORMAT.md#versioning)).
7. **Open a PR** with the capture and reference attached. The template walks you through it.

## What makes a good decode

- **Write down how you know.** A `description` like *"Fuel level from 0x50C D3:D4, matched cluster at full / ½ / reserve on 2026-07-11, 3 cars"* lets the next person trust or challenge it.
- **Set a real `minValue`/`maxValue`.** It filters glitches. A boost signal that can't physically exceed 35 psi shouldn't allow 400.
- **Watch out for flags.** Several Hyundai messages pack status bits next to the value (e.g. the DCT shift flags in `0x162`). A decode that looks right at steady state can spike during shifts or mode changes, so check your capture for outliers.
- **Prefer passive broadcast traffic.** Signals must come from what the car broadcasts on its own. KDMLink does not send diagnostic requests.

## Review and release

PRs need passing CI and a maintainer review. Merging does **not** ship to the app straight away: maintainers publish vehicle data releases separately, after testing.

By contributing you agree that your changes are licensed under CC BY-SA 4.0 (data, specs and docs) or MIT (scripts).
