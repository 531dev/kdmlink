// Shared helpers for the vehicle data tooling: layer resolution, composition
// and signal decoding. These mirror the KDMLink app exactly:
//   - layer order / merge rules  -> VehicleConfigComposer (vehicle_config_composer.dart)
//   - bit extraction             -> CanFrame.extractUnsigned / extractSigned
//   - raw -> physical            -> CanDecoderService._toPhysicalValue
// If you change behaviour here, it must match what the app does on-device.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SUPPORTED_SCHEMA_VERSION = 1;
export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const vehiclesDir = path.join(repoRoot, "vehicles");

const META_TOP_LEVEL_FIELDS = [
  "id",
  "version",
  "name",
  "make",
  "model",
  "years",
  "transmission",
  "notes",
  "displayName",
  "release_notes",
  "min_app_version",
  "supportsPowerTorque",
  "referenceTorqueNm",
  "powerGaugeMaxHp",
  "staticFrictionTorquePct",
  "frictionTorqueCurve",
];

/**
 * Ordered layer files (relative to vehicles/) for a canonical leaf ID such as
 * `hyundai.veloster_n.2019-2022.dct`. Later layers override earlier ones.
 */
export function layerPathsForId(id) {
  const parts = id.split(".");
  if (parts.length < 4 || parts.length > 5) {
    throw new Error(`Vehicle ID ${id} must have 4 or 5 dot-delimited segments`);
  }
  const [make, model, yearRange] = parts;
  const singleYear = parts.length === 5 ? parts[3] : null;
  const transmission = parts[parts.length - 1];
  return [
    "common.json",
    `${make}/common.json`,
    `${make}/${model}/base.json`,
    `${make}/${model}/${yearRange}/base.json`,
    ...(singleYear ? [`${make}/${model}/${yearRange}/${singleYear}.json`] : []),
    `${make}/${model}/${yearRange}/${transmission}.json`,
  ];
}

/**
 * Compose one leaf. `readLayer(relPath)` returns parsed JSON or null when the
 * (optional) layer does not exist; it defaults to reading the working tree.
 */
export async function composeLeaf(id, readLayer = readLayerFromDisk) {
  const signalMap = new Map(); // `${name}|${canId}` -> signal
  const meta = {};
  const layers = [];
  let schemaVersion = 1;

  for (const rel of layerPathsForId(id)) {
    const json = await readLayer(rel);
    if (json == null) continue;
    layers.push(rel);

    const layerSchema = Number(json.schema_version ?? 1);
    if (layerSchema > schemaVersion) schemaVersion = layerSchema;

    for (const signal of json.signals ?? []) {
      signalMap.set(`${signal.name}|${signal.canId}`, signal);
    }

    for (const entry of json.removeSignals ?? []) {
      if (typeof entry === "string") {
        const matches = [...signalMap.keys()].filter((k) =>
          k.startsWith(`${entry}|`),
        );
        if (matches.length > 1) {
          throw new Error(
            `${rel}: removeSignals "${entry}" matches multiple CAN IDs; use {"name", "canId"}`,
          );
        }
        matches.forEach((k) => signalMap.delete(k));
      } else {
        signalMap.delete(`${entry.name}|${entry.canId}`);
      }
    }

    for (const field of META_TOP_LEVEL_FIELDS) {
      if (Object.hasOwn(json, field)) meta[field] = json[field];
    }
    if (json.metadata && typeof json.metadata === "object") {
      Object.assign(meta, json.metadata);
    }
  }

  if (layers.length === 0) throw new Error(`No layers found for ${id}`);
  return { ...meta, schema_version: schemaVersion, layers, signals: [...signalMap.values()] };
}

export async function readLayerFromDisk(rel) {
  try {
    return JSON.parse(await fs.readFile(path.join(vehiclesDir, rel), "utf8"));
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

export async function readManifest(readLayer = readLayerFromDisk) {
  return readLayer("manifest.json");
}

/** Raw integer from a payload (Uint8Array / number[]), or null if out of range. */
export function extractRaw(data, signal) {
  const { startBit, bitLength } = signal;
  if (startBit + bitLength > data.length * 8) return null;

  let value = 0;
  let remaining = bitLength;
  let byteIndex = Math.floor(startBit / 8);
  let bitOffset = startBit % 8;

  if (!signal.isBigEndian) {
    // Intel: startBit is the LSB, bits run upward into following bytes.
    while (remaining > 0 && byteIndex < data.length) {
      const take = Math.min(remaining, 8 - bitOffset);
      const extracted = (data[byteIndex] >> bitOffset) & ((1 << take) - 1);
      value += extracted * 2 ** (bitLength - remaining);
      remaining -= take;
      byteIndex++;
      bitOffset = 0;
    }
  } else {
    // Motorola: startBit is the MSB, bits run downward then into the next byte.
    while (remaining > 0 && byteIndex < data.length) {
      const take = Math.min(remaining, bitOffset + 1);
      const shift = bitOffset - take + 1;
      const extracted = (data[byteIndex] >> shift) & ((1 << take) - 1);
      value = value * 2 ** take + extracted;
      remaining -= take;
      byteIndex++;
      bitOffset = 7;
    }
  }

  if (signal.isSigned && value >= 2 ** (bitLength - 1)) value -= 2 ** bitLength;
  return value;
}

/** Physical value, or null when the app would drop the sample. */
export function decodeSignal(data, signal) {
  const raw = extractRaw(data, signal);
  if (raw == null) return null;
  if (signal.ignoredRawValues?.includes(raw)) return null;

  const mapped = signal.valueMap?.[String(raw)];
  const value =
    mapped !== undefined
      ? mapped
      : raw * (signal.factor ?? 1) + (signal.offset ?? 0);

  const min = signal.minValue ?? 0;
  const max = signal.maxValue ?? 0;
  if (max > min && (value < min || value > max)) return null;
  return value;
}
