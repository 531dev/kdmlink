## What changed

<!-- e.g. "Add Kona N YawRate from 0x220 D5:D6" or "Fix Elantra N fuel level scaling" -->

## Vehicle(s) tested

| Vehicle | Year | Transmission | Market | Tune / mods |
|---------|------|--------------|--------|-------------|
|         |      |              |        |             |

## Evidence

<!-- Every new or changed signal needs evidence. PRs without it can't be merged. -->

- [ ] Capture attached or linked (KDMLink recorder CSV, candump, or SavvyCAN)
- [ ] Reference reading it was checked against (OBD-II scanner, cluster, dyno, known physical state…):
- [ ] `node scripts/decode.mjs <vehicle-id> <capture> --signals <Name>` output looks right across the range (idle, cruise, WOT / hot, cold — whatever applies)

## Checklist

- [ ] `node scripts/validate.mjs` passes
- [ ] Bumped `version` in every affected leaf file and added a one-line entry to its `notes`
- [ ] `description` says which bytes/bits are read and how it was validated
- [ ] Set `minValue`/`maxValue` to the physically possible range (samples outside are dropped)
