# KDMLink BLE Protocol

How to talk to a KDMLink device over Bluetooth Low Energy: discover it, pair with it, stream raw CAN frames, and send commands.

| | |
|---|---|
| Protocol revision | 1 |
| Firmware | 1.1.8 (current OTA release) |
| Transport | BLE 4.2+ GATT, LE Secure Connections |
| Vehicle bus | Hyundai/Kia C-CAN, 500 kbps, 11-bit IDs |

The device is a **transparent pipe**. It forwards raw CAN frames and does no signal decoding. To turn frames into RPM, boost, etc., use the vehicle definitions in [`../vehicles`](../vehicles) (format: [`../docs/FORMAT.md`](../docs/FORMAT.md)).

All multi-byte integers are **little-endian** unless stated otherwise.

---

## 1. Discovery

The device advertises connectable (`ADV_IND`) at a 20–40 ms interval.

| Packet | AD type | Value |
|--------|---------|-------|
| Advertising | Flags | `0x06` (LE General Discoverable, BR/EDR not supported) |
| Advertising | Complete List of 128-bit Service UUIDs | `4fafc201-1fb5-459e-8fcc-c5c9c331914b` |
| Advertising | Complete Local Name | `N-Link` |
| Scan response | Complete List of 16-bit Service UUIDs | `0x1FF8` (RaceChrono, see [§7](#7-racechrono-compatibility)) |

Filter scans on the 128-bit service UUID. The local name is fixed in advertising even after `SET_NAME` (that name is only reported in Device Info).

## 2. Pairing and ownership

- **Security:** LE Secure Connections with bonding, *Just Works* (no passkey). Every characteristic except Device Info requires an encrypted link, so the first read or write of a protected characteristic triggers pairing.
- **Single owner:** the first central to complete pairing becomes the device's **owner**, and the owner is stored in flash. After that, any other central that pairs has its bond removed and is disconnected. Only the owner can subscribe to telemetry or send commands.
- **One connection at a time:** a second simultaneous connection is closed immediately. Writes from it are acknowledged and discarded.
- **Releasing ownership:** send `FACTORY_RESET` from the owner (see [§5](#5-commands)). This erases all bonds and settings. The next central to pair becomes the new owner.

On iOS and Android, pair through the OS (AccessorySetupKit / CompanionDeviceManager, or simply by reading a protected characteristic) before subscribing.

## 3. GATT layout

Service `4fafc201-1fb5-459e-8fcc-c5c9c331914b`

| Characteristic | UUID | Properties | Security |
|----------------|------|------------|----------|
| Telemetry | `beb5483e-36e1-4688-b7f5-ea07361b26a8` | Notify | Encrypted |
| Command | `beb5483e-36e1-4688-b7f5-ea07361b26a9` | Write, Write Without Response | Encrypted |
| Device Info | `beb5483e-36e1-4688-b7f5-ea07361b26aa` | Read | Open |
| Config | `beb5483e-36e1-4688-b7f5-ea07361b26ab` | Read, Write | Encrypted (reserved, see below) |
| Status | `beb5483e-36e1-4688-b7f5-ea07361b26ac` | Read, Notify | Encrypted |
| OTA Data | `beb5483e-36e1-4688-b7f5-ea07361b26ad` | Write Without Response, Notify | Encrypted |

The **Config** characteristic is reserved and currently ignored. Configure the device through [commands](#5-commands) instead.

### MTU

Request an MTU of **512** right after connecting. The device prefers 512 and starts at the default of 23. The number of CAN frames per notification is computed from the negotiated MTU, so a small MTU works but carries one frame per packet.

## 4. Telemetry

Subscribe by writing `0x0001` to the Telemetry CCCD. Streaming starts on subscribe and stops on unsubscribe or disconnect.

Each notification carries **one or more frames**, back to back:

```
┌──────┬────────┬────────┬─────┬──────────────┐
│ 0xAA │ ID lo  │ ID hi  │ DLC │ DATA[DLC]    │  … repeated
└──────┴────────┴────────┴─────┴──────────────┘
  1 B     1 B      1 B     1 B    0–8 B
```

| Field | Size | Notes |
|-------|------|-------|
| Header | 1 | Always `0xAA`. Use it to re-sync if a frame looks wrong. |
| CAN ID | 2 | 11-bit standard ID, little-endian. |
| DLC | 1 | 0–8. |
| Data | DLC | Raw payload exactly as seen on the bus. |

A notification of `n` bytes ≤ `MTU − 3`. The device fills a notification with whole frames only (never split across notifications). The maximum is `floor((MTU − 3) / 12)` frames, which is 42 at MTU 512.

There are no timestamps. Stamp frames on arrival if you need them; the device sends a batch every `interval / 2` ms (see `SET_INTERVAL`).

#### Parsing (pseudo-code)

```python
def parse(notification: bytes):
    i = 0
    while i + 4 <= len(notification):
        if notification[i] != 0xAA:
            i += 1            # resync
            continue
        can_id = notification[i + 1] | (notification[i + 2] << 8)
        dlc = notification[i + 3]
        if dlc > 8 or i + 4 + dlc > len(notification):
            break
        yield can_id, notification[i + 4 : i + 4 + dlc]
        i += 4 + dlc
```

### Backpressure

If the BLE link congests (too many CAN IDs for the connection interval), the device discards the batch it was sending rather than queueing stale data. To reduce load, whitelist only the IDs you decode with `SET_FILTER`. The vehicle definitions tell you which IDs each signal needs.

## 5. Commands

Write to the Command characteristic (with or without response):

```
[CMD_ID 1B][PAYLOAD 0–N B]
```

Commands run asynchronously after the write is acknowledged. There is no per-command reply; check the result through Status or Device Info where relevant. Settings marked *persisted* survive reboot.

### Streaming

| ID | Name | Payload | Notes |
|----|------|---------|-------|
| `0x01` | SET_INTERVAL | `interval_ms` u16 | Telemetry batching interval. Default 50 ms; the device flushes every `interval / 2`. *Persisted.* |
| `0x02` | SET_FILTER | `count` u8, then `count × can_id` u16 | Forward only these CAN IDs (max 50). Replaces the previous filter. *Persisted.* |
| `0x03` | CLEAR_FILTER | — | Forward every CAN ID. *Persisted.* |

### Device

| ID | Name | Payload | Notes |
|----|------|---------|-------|
| `0x04` | REQUEST_INFO | — | No-op; read Device Info directly. |
| `0x05` | SET_NAME | UTF-8 name (≤ 31 bytes) | Friendly name reported in Device Info. *Persisted.* |
| `0x23` | RACECHRONO_ENABLE | `enabled` u8 (0/1) | Turns the RaceChrono service on or off. *Persisted.* |
| `0xFE` | FACTORY_RESET | `0xDEADBEEF` u32 | Clears bonds, owner and all settings, then reboots. Any other payload is ignored. |
| `0xFF` | RESTART | — | Reboots after ~100 ms. |

### Vehicle output

> ⚠️ These commands **transmit onto the vehicle's CAN bus** or drive the device's relay output. Only the bonded owner can send them. Sending the wrong frames to a moving vehicle can change how it behaves: test parked, and only on your own car.

| ID | Name | Payload | Notes |
|----|------|---------|-------|
| `0x06` | CAN_INJECT | `can_id` u16, `dlc` u8, `data[dlc]` | Transmits one frame. Rate-limited to 10/s; extra frames are dropped. Frames to `0x2FC` are sent as a 500 ms burst (25 × 20 ms). |
| `0x20` | EXHAUST_ENABLE | `enabled` u8 | Arms the relay output. `EXHAUST_STATE` is ignored until enabled. *Persisted.* |
| `0x21` | EXHAUST_STATE | `open` u8 | Sets the relay output. |
| `0x22` | DRIVE_MODE | `mode` u8: 0 Normal, 1 Sport, 2 Eco, 3 N, 4 N Custom | Sends a drive-mode request burst on `0x2FC`. |

### Firmware update

`0xF0`–`0xF5`: see [§6.3](#63-firmware-update-ota).

## 6. Status and info

### 6.1 Device Info (read, 43 bytes)

| Offset | Size | Field |
|--------|------|-------|
| 0 | 1 | Firmware major |
| 1 | 1 | Firmware minor |
| 2 | 1 | Firmware patch |
| 3 | 8 | Hardware revision, ASCII, NUL-padded |
| 11 | 32 | Device name, UTF-8, NUL-padded |

### 6.2 Status (read / notify, 8 bytes)

Refreshed once per second; read it on demand. The device also sends a notification when error recovery runs. In that notification **only the error code is valid** (firmware 1.1.8 leaves the other fields unset), so re-read the characteristic for the rest.

| Offset | Size | Field |
|--------|------|-------|
| 0 | 1 | Link state: 0 idle, 1 advertising, 2 connected, 3 streaming, 4 OTA |
| 1 | 1 | CAN active: 1 if frames are being received |
| 2 | 2 | Last error code (table below) |
| 4 | 2 | CAN frames per second on the bus |
| 6 | 2 | Negotiated MTU |

#### Error codes

| Range | Category | Codes |
|-------|----------|-------|
| `0x0000` | — | None |
| `0x0001–0x000F` | CAN | `01` not responding · `02` bus error · `03` RX overflow · `04` init failed · `05` TX failed · `06` filter failed · `07` recovery failed |
| `0x0010–0x001F` | BLE | `10` init · `11` advertising · `12` connection dropped · `13` MTU · `14` notify · `15` GATT · `16` TX overflow |
| `0x0020–0x002F` | Storage | `20` read · `21` write · `22` init · `23` namespace · `24` erase |
| `0x0030–0x003F` | GPIO | `30` init · `31` LED · `32` button |
| `0x0040–0x004F` | Output | `40` relay · `41` watchdog · `42` CAN inject failed |
| `0x00F0–0x00FE` | OTA | `F0` download · `F1` verify · `F2` write · `F3` rollback · `F4` invalid image · `F5` no partition · `F6` too large · `F7` sequence gap · `F8` timeout · `F9` already running · `FA` not started |
| `0x00FF` | System | Unknown fatal |

### 6.3 Firmware update (OTA)

Images are ESP32-S3 app binaries. Each update must state the image's SHA-256, and an image that doesn't match it is rejected. A failed boot rolls back to the previous image.

1. Subscribe to **OTA Data** notifications.
2. Command `0xF0` ENTER_OTA. Telemetry stops; the device notifies status phase `READY`.
3. Command `0xF1` OTA_BEGIN: `size` u32 + `sha256` 32 B.
4. Write chunks to **OTA Data** (write without response): `seq` u16 + up to `MTU − 5` bytes (507 at MTU 512). `seq` starts at 0 and increments by one per chunk.
5. The device notifies progress every 8 chunks and at the end. On a sequence gap it reports `F7` and the last good `seq`: resend from `last_seq + 1`. Duplicates are ignored.
6. Command `0xF3` OTA_END. The device verifies the hash and reports phase `COMPLETE` (or an error).
7. Command `0xFF` RESTART to boot the new image.

Send `0xF4` OTA_ABORT at any point to cancel. If no data arrives for 30 s, the device aborts on its own.

**OTA status notification (12 bytes):**

| Offset | Size | Field |
|--------|------|-------|
| 0 | 1 | Status: 0 OK, 1 error, 2 busy |
| 1 | 1 | Phase: 0 idle, 1 ready, 2 receiving, 3 verifying, 4 complete, 5 error |
| 2 | 2 | Last contiguous `seq` received |
| 4 | 4 | Bytes written |
| 8 | 2 | Error code (0 if none) |
| 10 | 1 | Reserved |
| 11 | 1 | XOR of bytes 0–10 |

## 7. RaceChrono compatibility

When enabled with `RACECHRONO_ENABLE` (off by default), the device also exposes the standard [RaceChrono DIY BLE CAN-Bus API](https://github.com/aollin/racechrono-ble-diy-device), so RaceChrono can use it directly without the KDMLink app:

| | UUID |
|---|---|
| Service | `0x1FF8` |
| CAN data (Read, Notify) | `0x0001`: `can_id` u32 LE + data, one frame per notification |
| Filter (Write) | `0x0002`: `00` deny all · `01 iv_hi iv_lo` allow all · `02 iv_hi iv_lo id[4]` allow ID (interval big-endian) |

RaceChrono's own PID filter (max 50 IDs) applies only to that service and does not affect the KDMLink telemetry stream.

---

## Changelog

| Revision | Firmware | Changes |
|----------|----------|---------|
| 1 | 1.1.8 | First published revision. |
