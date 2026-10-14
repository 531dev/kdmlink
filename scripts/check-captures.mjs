#!/usr/bin/env node
// Decodes every capture under captures/ and compares the result with its
// expected.json. CI runs this so a config change that alters decoded values
// on real car data is caught. If the change is intentional, regenerate:
//
//   node scripts/check-captures.mjs            # verify
//   node scripts/check-captures.mjs --update   # rewrite expected.json files
//
// expected.json is also the reference for integrators: replay the capture,
// and your decoder should produce these numbers.

import { promises as fs } from "node:fs";
import path from "node:path";
import { readFrames } from "./lib/capture.mjs";
import { composeLeaf, decodeSignal, repoRoot } from "./lib/vehicles.mjs";

const capturesDir = path.join(repoRoot, "captures");
const round = (v) => Math.round(v * 1e4) / 1e4;

async function summarize(dir, expected) {
  const config = await composeLeaf(expected.vehicle);
  const byCanId = new Map();
  for (const s of config.signals) {
    if (!byCanId.has(s.canId)) byCanId.set(s.canId, []);
    byCanId.get(s.canId).push(s);
  }

  const checkpoints = [...(expected.checkpoints ?? [])].sort((a, b) => a.atMs - b.atMs);
  const checkpointValues = checkpoints.map(() => ({}));
  const latest = {};
  const signals = {};
  const canIds = new Set();
  let frames = 0;
  let firstMs = null;
  let lastMs = null;
  let nextCheckpoint = 0;

  for await (const frame of readFrames(path.join(dir, expected.capture))) {
    const ms = frame.timeMs;
    if (ms == null || Number.isNaN(ms)) throw new Error(`${expected.capture}: frames need timestamps`);
    firstMs ??= ms;
    // Snapshot the latest value of every signal as each checkpoint passes.
    while (nextCheckpoint < checkpoints.length && ms - firstMs > checkpoints[nextCheckpoint].atMs) {
      checkpointValues[nextCheckpoint++] = { ...latest };
    }
    lastMs = ms;
    frames++;
    canIds.add(frame.canId);

    for (const s of byCanId.get(frame.canId) ?? []) {
      const stat = (signals[s.name] ??= { samples: 0, dropped: 0 });
      const value = decodeSignal(frame.data, s);
      if (value == null) {
        stat.dropped++;
        continue;
      }
      const v = round(value);
      stat.samples++;
      stat.first ??= v;
      stat.last = v;
      stat.min = Math.min(stat.min ?? v, v);
      stat.max = Math.max(stat.max ?? v, v);
      latest[s.name] = v;
    }
  }
  while (nextCheckpoint < checkpoints.length) checkpointValues[nextCheckpoint++] = { ...latest };

  const sortedSignals = Object.fromEntries(
    Object.keys(signals)
      .sort()
      .map((k) => {
        const { samples, dropped, min, max, first, last } = signals[k];
        return [k, { samples, dropped, min, max, first, last }];
      }),
  );

  return {
    ...expected,
    configVersion: config.version,
    frames,
    canIds: canIds.size,
    durationMs: lastMs - firstMs,
    checkpoints: checkpoints.map((c, i) => ({
      atMs: c.atMs,
      label: c.label,
      values: Object.fromEntries(
        (c.signals ?? Object.keys(checkpointValues[i]).sort()).map((k) => [k, checkpointValues[i][k] ?? null]),
      ),
      ...(c.signals ? { signals: c.signals } : {}),
    })),
    signals: sortedSignals,
  };
}

function diff(expected, actual, where = "") {
  const out = [];
  if (typeof expected !== "object" || expected === null || typeof actual !== "object" || actual === null) {
    if (expected !== actual) out.push(`${where}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    return out;
  }
  for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    out.push(...diff(expected[key], actual[key], where ? `${where}.${key}` : key));
  }
  return out;
}

async function main() {
  const update = process.argv.includes("--update");
  let entries = [];
  try {
    entries = await fs.readdir(capturesDir, { withFileTypes: true });
  } catch {
    console.log("no captures/ directory");
    return;
  }

  let failures = 0;
  for (const entry of entries.filter((e) => e.isDirectory())) {
    const dir = path.join(capturesDir, entry.name);
    const expectedPath = path.join(dir, "expected.json");
    const expected = JSON.parse(await fs.readFile(expectedPath, "utf8"));
    const actual = await summarize(dir, expected);

    if (update) {
      await fs.writeFile(expectedPath, `${JSON.stringify(actual, null, 2)}\n`);
      console.log(`↻ ${entry.name}: expected.json updated (${actual.vehicle} ${actual.configVersion})`);
      continue;
    }

    const problems = diff(expected, actual);
    if (problems.length === 0) {
      console.log(`✓ ${entry.name}: ${actual.frames} frames match expected values`);
    } else {
      failures++;
      console.error(`✗ ${entry.name}: ${problems.length} difference(s)`);
      for (const p of problems.slice(0, 25)) console.error(`  - ${p}`);
      if (problems.length > 25) console.error(`  … ${problems.length - 25} more`);
    }
  }

  if (failures > 0) {
    console.error(
      "\nDecoded values changed. If that is intended, run `node scripts/check-captures.mjs --update` " +
        "and explain the change in your PR.",
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
