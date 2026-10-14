# Elantra N 2025 DCT: street drive

A real C-CAN capture from a 2025 Hyundai Elantra N with the 8-speed DCT, recorded through a KDMLink on 2026-09-18. It's a 5.8-minute street drive on a warm engine: idle, reverse, city driving, and one full-throttle pull (141.7–147.6 s) to 116 km/h.

| | |
|---|---|
| Vehicle config | `hyundai.elantra_n.2022-2026.dct` |
| Duration | 348.8 s |
| Frames | 712,741 (11-bit, 500 kbps) |
| CAN IDs | 88 |
| Cluster units | mph (`SpeedUnit` = 1); `Odometer` reads 32,924 mi |

## Files

All files contain the same frames. They're gzipped (about 5 MB each); `gunzip -k <file>` before loading them into a tool that can't read `.gz`.

| File | Format | Load with |
|------|--------|-----------|
| `capture.csv.gz` | KDMLink recorder export (`timestamp_ms,can_id_hex,can_id_dec,dlc,data_hex`) | Anything that reads CSV; `scripts/decode.mjs` |
| `capture.log.gz` | SocketCAN `candump -l` | `canplayer`, python-can, SavvyCAN |
| `capture.asc.gz` | Vector ASCII | CANoe, CANalyzer, most commercial CAN simulators |
| `capture.trc.gz` | PEAK PCAN trace v2.1 | PCAN-View, PCAN-Explorer |
| `expected.json` | Expected decoded values | Your test suite |

## Replaying it into a KDMLink on the bench

```
CAN simulator ── CAN-H / CAN-L ── KDMLink ── BLE ── your app
        120 Ω at each end of the bench bus, 500 kbps, 12 V supply to the device
```

The KDMLink acknowledges frames (its controller runs in normal mode), so a simulator and a KDMLink alone make a valid bus.

```bash
# SocketCAN (Linux)
gunzip -k capture.log.gz
sudo ip link set can0 up type can bitrate 500000
canplayer -I capture.log can0=can0        # replays with original timing
```

In CANoe or CANalyzer, add `capture.asc` to a Replay block. In PCAN-View, open `capture.trc` and use the trace player.

With no hardware at all, decode the file directly:

```bash
node scripts/decode.mjs hyundai.elantra_n.2022-2026.dct captures/elantra-n-2025-dct-street/capture.csv.gz --signals EngineRPM_2,BoostPressurePsi,CurrentGear
```

## Expected values

`expected.json` has the result of decoding this capture with the vehicle config: per-signal sample counts, min, max, first and last values, plus the checkpoints below. A **checkpoint value** is the last valid sample of that signal at or before the checkpoint time, measured from the first frame. CI re-decodes the capture on every change to the configs, so these numbers stay in sync with `vehicles/`.

**Parked, idling** at `5.000 s`

| Signal | Value |
|---|---|
| `EngineRPM_2` | 712 rpm |
| `VehicleSpeed` | 0 km/h |
| `CurrentGear` | 0  |
| `AccelPedalPos` | 0 % |
| `BoostPressurePsi` | -0.047 psi |
| `CoolantTemp` | 81.75 degC |
| `OilTemp` | 77 degC |
| `BatteryVoltage` | 13.4 V |
| `Odometer` | 32923.9 km |

**Reverse engaged** at `16.700 s`

| Signal | Value |
|---|---|
| `EngineRPM_2` | 735 rpm |
| `VehicleSpeed` | 0 km/h |
| `CurrentGear` | 14  |
| `AccelPedalPos` | 0 % |
| `BoostPressurePsi` | -0.047 psi |
| `SteeringAngle` | -2.7 deg |

**Full-throttle pull, peak boost** at `144.681 s`

| Signal | Value |
|---|---|
| `EngineRPM_2` | 5209 rpm |
| `VehicleSpeed` | 87 km/h |
| `CurrentGear` | 3  |
| `AccelPedalPos` | 99.6079 % |
| `ThrottlePosition` | 74.2769 % |
| `BoostPressurePsi` | 18.2066 psi |
| `ManifoldPressureHiRes` | 226.855 kPa |
| `EngineTorqueActualPct` | 74.6094 % |

**Top speed** at `147.700 s`

| Signal | Value |
|---|---|
| `EngineRPM_2` | 6045 rpm |
| `VehicleSpeed` | 116 km/h |
| `VehicleSpeedMph` | 75 mph |
| `CurrentGear` | 3  |
| `AccelPedalPos` | 0 % |
| `BoostPressurePsi` | 14.3718 psi |

### Ranges over the whole drive

| Signal | Min | Max | Samples |
|---|---|---|---|
| `EngineRPM_2` | 682 | 6443 rpm | 26,949 |
| `VehicleSpeed` | 0 | 116 km/h | 26,949 |
| `CurrentGear` | 0 | 14  | 26,896 |
| `BoostPressurePsi` | -0.4688 | 18.2066 psi | 5,508 |
| `ManifoldPressureHiRes` | 98.0924 | 226.855 kPa | 5,508 |
| `AccelPedalPos` | 0 | 99.6079 % | 27,391 |
| `EngineTorqueActualPct` | 0 | 78.5156 % | 27,412 |
| `CoolantTemp` | 81 | 93 degC | 27,391 |
| `OilTemp` | 77 | 89 degC | 5,508 |
| `IntakeTemp` | 49.5 | 55.5 degC | 13,733 |
| `BatteryVoltage` | 13 | 13.5 V | 2,705 |
| `FuelLevel` | 79.4329 | 80.0369 % | 2,723 |
| `SteeringAngle` | -396.5 | 393.4 deg | 27,254 |
| `TPMS_FL` | 35 | 255 psi | 1,379 |

### Notes for integrators

- **Tire pressures start as `255`.** The car broadcasts `0xFF` ("no reading yet") for about the first 2 minutes after start-up (454 of 1,379 TPMS frames here). The KDMLink app hides 255. Your decoder should too.
- **`CurrentGear` encodes 0 as P/N and 14 as reverse**, with 1–8 as forward gears.
- **`FuelLevel` reads about 80 %.** The cluster value wasn't recorded for this drive, and 2024+ Elantra N fuel scaling is still open (see the main README's help-wanted list), so treat fuel as unverified on this car.
- `YawRate` hits its ±20.47 limits during the drive; that encoding is also still being verified.
