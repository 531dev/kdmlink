#!/usr/bin/env node
// Validates every file under vehicles/ and composes every leaf in the
// manifest. With --base <git-ref>, also enforces the version-bump rule: any
// change to a layer a leaf composes from must bump that leaf's `version`.
//
//   node scripts/validate.mjs
//   node scripts/validate.mjs --base origin/main

import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  SUPPORTED_SCHEMA_VERSION,
  composeLeaf,
  layerPathsForId,
  readManifest,
  repoRoot,
  vehiclesDir,
} from "./lib/vehicles.mjs";

const ID_REGEX = /^[a-z0-9_]+\.[a-z0-9_]+\.\d{4}-\d{4}(\.\d{4})?\.[a-z0-9_]+$/;
const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;
const SIGNAL_NAME_REGEX = /^[A-Za-z][A-Za-z0-9_]*$/;

const LAYER_KEYS = new Set([
  "schema_version",
  "version",
  "id",
  "name",
  "make",
  "model",
  "years",
  "transmission",
  "notes",
  "displayName",
  "release_notes",
  "min_app_version",
  "metadata",
  "signals",
  "removeSignals",
]);
const METADATA_KEYS = new Set([
  "make",
  "model",
  "displayName",
  "supportsPowerTorque",
  "referenceTorqueNm",
  "powerGaugeMaxHp",
  "staticFrictionTorquePct",
  "frictionTorqueCurve",
]);
const SIGNAL_KEYS = new Set([
  "name",
  "canId",
  "startBit",
  "bitLength",
  "isBigEndian",
  "isSigned",
  "factor",
  "offset",
  "minValue",
  "maxValue",
  "unit",
  "description",
  "valueMap",
  "ignoredRawValues",
]);
const MANIFEST_ENTRY_KEYS = new Set([
  "id",
  "displayName",
  "make",
  "model",
  "years",
  "transmission",
  "tags",
]);

const errors = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);
const isInt = (v) => Number.isInteger(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

function checkUnknownKeys(where, obj, allowed) {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) fail(where, `unknown key "${key}"`);
  }
}

function validateSignal(where, s) {
  if (!s || typeof s !== "object") return fail(where, "signal must be an object");
  checkUnknownKeys(where, s, SIGNAL_KEYS);

  if (typeof s.name !== "string" || !SIGNAL_NAME_REGEX.test(s.name)) {
    fail(where, `name must match ${SIGNAL_NAME_REGEX}`);
  }
  if (!isInt(s.canId) || s.canId < 0 || s.canId > 0x7ff) {
    fail(where, "canId must be an 11-bit integer (0-2047)");
  }
  if (!isInt(s.startBit) || s.startBit < 0 || s.startBit > 63) {
    fail(where, "startBit must be an integer 0-63");
  }
  if (!isInt(s.bitLength) || s.bitLength < 1 || s.bitLength > 32) {
    fail(where, "bitLength must be an integer 1-32");
  }
  if (isInt(s.startBit) && isInt(s.bitLength) && !s.isBigEndian) {
    if (s.startBit + s.bitLength > 64) {
      fail(where, "startBit + bitLength runs past the 8-byte payload");
    }
  }
  for (const key of ["isBigEndian", "isSigned"]) {
    if (key in s && typeof s[key] !== "boolean") fail(where, `${key} must be a boolean`);
  }
  for (const key of ["factor", "offset", "minValue", "maxValue"]) {
    if (key in s && !isNum(s[key])) fail(where, `${key} must be a number`);
  }
  for (const key of ["unit", "description"]) {
    if (key in s && typeof s[key] !== "string") fail(where, `${key} must be a string`);
  }
  if (typeof s.description !== "string" || s.description.trim() === "") {
    fail(where, "description is required (say which bytes/bits it reads and how it was validated)");
  }
  if (isNum(s.minValue) && isNum(s.maxValue) && s.minValue > s.maxValue) {
    fail(where, "minValue is greater than maxValue");
  }

  const rawMax = isInt(s.bitLength) ? 2 ** s.bitLength - 1 : Infinity;
  const rawMin = s.isSigned && isInt(s.bitLength) ? -(2 ** (s.bitLength - 1)) : 0;
  if ("valueMap" in s) {
    if (!s.valueMap || typeof s.valueMap !== "object" || Array.isArray(s.valueMap)) {
      fail(where, "valueMap must be an object of rawValue -> physical number");
    } else {
      for (const [raw, phys] of Object.entries(s.valueMap)) {
        if (!/^-?\d+$/.test(raw)) fail(where, `valueMap key "${raw}" must be an integer`);
        else if (+raw < rawMin || +raw > rawMax) fail(where, `valueMap key ${raw} does not fit in ${s.bitLength} bits`);
        if (!isNum(phys)) fail(where, `valueMap["${raw}"] must be a number`);
      }
    }
  }
  if ("ignoredRawValues" in s) {
    if (!Array.isArray(s.ignoredRawValues)) {
      fail(where, "ignoredRawValues must be an array of integers");
    } else {
      for (const raw of s.ignoredRawValues) {
        if (!isInt(raw) || raw < rawMin || raw > rawMax) {
          fail(where, `ignoredRawValues entry ${raw} does not fit in ${s.bitLength} bits`);
        }
      }
    }
  }
}

function validateLayer(rel, json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return fail(rel, "top level must be an object");
  }
  checkUnknownKeys(rel, json, LAYER_KEYS);

  if (!isInt(json.schema_version) || json.schema_version < 1) {
    fail(rel, "schema_version must be a positive integer");
  } else if (json.schema_version > SUPPORTED_SCHEMA_VERSION) {
    fail(rel, `schema_version ${json.schema_version} is newer than supported ${SUPPORTED_SCHEMA_VERSION}`);
  }
  if ("version" in json && !SEMVER_REGEX.test(json.version)) {
    fail(rel, `version "${json.version}" must be MAJOR.MINOR.PATCH`);
  }
  if ("metadata" in json) {
    if (!json.metadata || typeof json.metadata !== "object") fail(rel, "metadata must be an object");
    else checkUnknownKeys(`${rel} metadata`, json.metadata, METADATA_KEYS);
    const curve = json.metadata?.frictionTorqueCurve;
    if (curve !== undefined) {
      const ok =
        Array.isArray(curve) &&
        curve.every((p) => Array.isArray(p) && p.length === 2 && p.every(isNum)) &&
        curve.every((p, i) => i === 0 || p[0] > curve[i - 1][0]);
      if (!ok) fail(rel, "metadata.frictionTorqueCurve must be [[rpm, pct], ...] with strictly increasing rpm");
    }
  }

  if ("signals" in json && !Array.isArray(json.signals)) fail(rel, "signals must be an array");
  const seen = new Set();
  (Array.isArray(json.signals) ? json.signals : []).forEach((s, i) => {
    const where = `${rel} signals[${i}]${s?.name ? ` (${s.name})` : ""}`;
    validateSignal(where, s);
    const key = `${s?.name}|${s?.canId}`;
    if (seen.has(key)) fail(where, "duplicate (name, canId) in the same file");
    seen.add(key);
  });

  if ("removeSignals" in json) {
    if (!Array.isArray(json.removeSignals)) {
      fail(rel, "removeSignals must be an array");
    } else {
      json.removeSignals.forEach((e, i) => {
        const ok =
          typeof e === "string" ||
          (e && typeof e === "object" && typeof e.name === "string" && isInt(e.canId));
        if (!ok) fail(`${rel} removeSignals[${i}]`, 'must be a name string or {"name", "canId"}');
      });
    }
  }
}

async function listJsonFiles(dir, prefix = "") {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) out.push(...(await listJsonFiles(path.join(dir, entry.name), rel)));
    else if (entry.name.endsWith(".json")) out.push(rel);
  }
  return out.sort();
}

function compareSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

function git(...args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

async function checkVersionBumps(baseRef, manifest) {
  const changed = new Set(
    git("diff", "--name-only", `${baseRef}...HEAD`, "--", "vehicles")
      .split("\n")
      .filter(Boolean)
      .map((p) => p.replace(/^vehicles\//, "")),
  );
  if (changed.size === 0) return;

  const readAtBase = async (rel) => {
    try {
      return JSON.parse(git("show", `${baseRef}:vehicles/${rel}`));
    } catch {
      return null;
    }
  };

  for (const { id } of manifest.vehicles) {
    const touched = layerPathsForId(id).filter((rel) => changed.has(rel));
    if (touched.length === 0) continue;

    let before;
    try {
      before = await composeLeaf(id, readAtBase);
    } catch {
      continue; // leaf is new in this change
    }
    const after = await composeLeaf(id);
    if (!before.version || !after.version) continue;
    if (compareSemver(after.version, before.version) <= 0) {
      fail(
        id,
        `changed via ${touched.join(", ")} but version is still ${after.version}. ` +
          `Bump "version" in ${layerPathsForId(id).at(-1)} (published files are immutable per version).`,
      );
    }
  }
}

async function main() {
  const baseIdx = process.argv.indexOf("--base");
  const baseRef = baseIdx > -1 ? process.argv[baseIdx + 1] : null;

  const files = await listJsonFiles(vehiclesDir);
  const parsed = new Map();
  for (const rel of files) {
    try {
      parsed.set(rel, JSON.parse(await fs.readFile(path.join(vehiclesDir, rel), "utf8")));
    } catch (err) {
      fail(rel, `invalid JSON: ${err.message}`);
    }
  }

  const manifest = parsed.get("manifest.json");
  if (!manifest) {
    fail("manifest.json", "missing");
  } else {
    if (!Array.isArray(manifest.vehicles)) fail("manifest.json", "vehicles must be an array");
    const ids = new Set();
    for (const [i, v] of (manifest.vehicles ?? []).entries()) {
      const where = `manifest.json vehicles[${i}]`;
      checkUnknownKeys(where, v, MANIFEST_ENTRY_KEYS);
      if (!ID_REGEX.test(v.id ?? "")) fail(where, `id "${v.id}" must look like make.model.YYYY-YYYY.transmission`);
      if (ids.has(v.id)) fail(where, `duplicate id ${v.id}`);
      ids.add(v.id);
      for (const key of ["displayName", "make", "model", "years", "transmission"]) {
        if (typeof v[key] !== "string" || !v[key]) fail(where, `${key} is required`);
      }
    }
  }

  const reachable = new Set(["manifest.json"]);
  for (const v of manifest?.vehicles ?? []) {
    layerPathsForId(v.id).forEach((rel) => reachable.add(rel));
  }
  for (const [rel, json] of parsed) {
    if (rel === "manifest.json") continue;
    if (!reachable.has(rel)) fail(rel, "not used by any vehicle in manifest.json (wrong folder name?)");
    validateLayer(rel, json);
  }

  if (errors.length === 0 && manifest) {
    for (const v of manifest.vehicles) {
      const leafRel = layerPathsForId(v.id).at(-1);
      if (!parsed.has(leafRel)) {
        fail(v.id, `leaf file vehicles/${leafRel} is missing`);
        continue;
      }
      const composed = await composeLeaf(v.id).catch((err) => fail(v.id, err.message));
      if (!composed) continue;
      if (composed.id !== v.id) fail(v.id, `leaf declares id "${composed.id}"`);
      if (!SEMVER_REGEX.test(composed.version ?? "")) fail(v.id, "leaf must declare a version");
      for (const key of ["name", "make", "model", "years", "transmission"]) {
        if (typeof composed[key] !== "string" || !composed[key]) fail(v.id, `composed config is missing "${key}"`);
      }
      for (const key of ["make", "model", "years", "transmission"]) {
        if (composed[key] && v[key] && composed[key] !== v[key]) {
          fail(v.id, `manifest ${key} "${v[key]}" != config ${key} "${composed[key]}"`);
        }
      }
      if (composed.signals.length === 0) fail(v.id, "composes to zero signals");
    }
  }

  if (baseRef && errors.length === 0) await checkVersionBumps(baseRef, manifest);

  if (errors.length > 0) {
    console.error(`✗ ${errors.length} problem(s):\n`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`✓ ${files.length} files valid, ${manifest.vehicles.length} vehicles compose cleanly`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
