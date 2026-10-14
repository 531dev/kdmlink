# Test captures

Real CAN recordings with the values they should decode to. Use them to:

- **Replay on a bench:** feed a capture from a CAN simulator into a KDMLink and check your app shows the expected values. Each capture's README has the wiring and replay commands.
- **Test a decoder** without a car or any hardware.
- **Catch regressions:** CI decodes every capture on each change to `vehicles/` and fails if the results move from `expected.json`.

| Capture | Vehicle | Length | Highlights |
|---------|---------|--------|------------|
| [`elantra-n-2025-dct-street`](elantra-n-2025-dct-street) | 2025 Elantra N DCT | 5.8 min | Idle, reverse, full-throttle pull to 18.2 psi / 6,443 rpm, 116 km/h |

## Contributing a capture

Captures from other cars, transmissions and model years are very welcome. Record with the KDMLink app (**Settings → CAN Bus Recorder**) or `candump -l`, then open a PR that adds a folder with:

1. The capture, gzipped.
2. An `expected.json` with `capture`, `vehicle` and any `checkpoints` you want pinned (`atMs` from the first frame, a `label`, and optionally the `signals` to record). Then run `node scripts/check-captures.mjs --update` to fill in the values.
3. A short README: the car, what happened during the drive, and anything you checked against a reference (cluster, scanner, gauge).

Recordings include whatever the car broadcasts, such as its odometer reading. Don't contribute a capture you aren't comfortable publishing.
