# Config format

## Signals

```json
{
  "name": "EngineRPM",
  "canId": 790,
  "startBit": 16,
  "bitLength": 16,
  "isBigEndian": false,
  "isSigned": false,
  "factor": 0.25,
  "offset": 0.0,
  "minValue": 0.0,
  "maxValue": 16383.75,
  "unit": "rpm",
  "description": "Engine RPM from CAN 0x316 bytes 2-3 LE. Validated 2026-06-07 dual capture, r2=0.992. Confidence: high."
}
```

| Field | Required | Meaning |
|-------|----------|---------|
| `name` | yes | The name the app uses for this value. Reuse an existing name (`EngineRPM`, `VehicleSpeed`, `FuelLevel`…) so it lands on the right gauge. |
| `canId` | yes | 11-bit CAN ID **in decimal** (`0x316` → `790`). |
| `startBit` | yes | Little-endian: position of the least significant bit, counted as `byte * 8 + bit` (byte 2 bit 0 = `16`). Big-endian (Motorola): position of the most significant bit. |
| `bitLength` | yes | 1–32. |
| `isBigEndian` | no | Default `false` (Intel). Nearly every Hyundai signal is little-endian. |
| `isSigned` | no | Two's complement. Default `false`. |
| `factor`, `offset` | no | `physical = raw * factor + offset`. Defaults are 1 and 0. |
| `minValue`, `maxValue` | no | Valid physical range. **Samples outside it are dropped** and the gauge keeps its last good value. Leave both at `0` to disable the check (only do this deliberately and say why in `description`). |
| `unit` | no | Shown in the app (`rpm`, `kPa`, `psi`, `°C`, `%`, `V`…). |
| `description` | yes | Which bytes/bits are read, and how the decode was validated. |
| `valueMap` | no | `{"raw": physical}` lookup for enumerated or nonlinear values (gears, modes). It takes precedence over `factor`/`offset`. |
| `ignoredRawValues` | no | Raw values that mean "no data" or "in transition". They are dropped. |

Bytes are counted from `D0`. The descriptions use `D3:D4` to mean a 16-bit little-endian value with `D3` as the low byte.

## Layers

| Key | Where | Meaning |
|-----|-------|---------|
| `schema_version` | every file | Currently `1`. |
| `signals` | any layer | Added to, or replacing, what was inherited. The key is `name` + `canId`. |
| `removeSignals` | any layer | Drops inherited signals: `"Name"` (only if that name exists on a single CAN ID) or `{"name": "Name", "canId": 1234}`. |
| `metadata` | model `base.json` | Power/torque model parameters: `supportsPowerTorque`, `referenceTorqueNm`, `powerGaugeMaxHp`, `staticFrictionTorquePct`, `frictionTorqueCurve` (`[[rpm, pct], …]`). |
| `id`, `version`, `name`, `years`, `transmission` | leaf | Identify the concrete vehicle. `id` must match the file path. |
| `notes` | leaf | Changelog. Add one sentence per version. |

## Versioning

Each leaf has a `version` (`MAJOR.MINOR.PATCH`). Published config files are **immutable per version**: apps that already downloaded `1.0.9` never re-fetch `1.0.9`. So **any** change that affects a vehicle must bump that vehicle's leaf `version`, including a change to `common.json` or a `base.json` it inherits from. CI enforces this.

- Patch: fixed scaling, range, description.
- Minor: new signals.
- Major: renamed or removed signals, or structural changes.

## Adding a vehicle

1. Add an entry to `vehicles/manifest.json` with the ID `make.model.YYYY-YYYY.transmission`. Add the `experimental` tag until it has been validated on more than one car.
2. Create the matching leaf file, plus `base.json` files if you want to share signals between transmissions.
3. Run `node scripts/validate.mjs`.
