#!/usr/bin/env node
// Decode a CAN capture with a vehicle config, the same way the app does.
// Prints CSV: time,canId,signal,raw,value  (value is empty when the app would
// drop the sample: ignoredRawValues hit or outside minValue..maxValue).
//
//   node scripts/decode.mjs <vehicle-id> <capture> [--signals EngineRPM,BoostPressurePsi]
//   node scripts/decode.mjs --list <vehicle-id>
//
// Captures may be gzipped. Supported formats are listed in lib/capture.mjs.

import { readFrames } from "./lib/capture.mjs";
import { composeLeaf, decodeSignal, extractRaw } from "./lib/vehicles.mjs";

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--list") {
    const config = await composeLeaf(args[1]);
    for (const s of config.signals) {
      console.log(`0x${s.canId.toString(16).toUpperCase().padStart(3, "0")}  ${s.name.padEnd(28)} ${s.unit ?? ""}`);
    }
    return;
  }

  const [id, file] = args;
  if (!id || !file) {
    console.error("usage: node scripts/decode.mjs <vehicle-id> <capture> [--signals A,B]");
    console.error("       node scripts/decode.mjs --list <vehicle-id>");
    process.exit(2);
  }
  const sigIdx = args.indexOf("--signals");
  const only = sigIdx > -1 ? new Set(args[sigIdx + 1].split(",")) : null;

  const config = await composeLeaf(id);
  const byCanId = new Map();
  for (const s of config.signals) {
    if (only && !only.has(s.name)) continue;
    if (!byCanId.has(s.canId)) byCanId.set(s.canId, []);
    byCanId.get(s.canId).push(s);
  }

  console.log("time,canId,signal,raw,value");
  for await (const frame of readFrames(file)) {
    for (const s of byCanId.get(frame.canId) ?? []) {
      const raw = extractRaw(frame.data, s);
      if (raw == null) continue;
      const value = decodeSignal(frame.data, s);
      const hexId = `0x${frame.canId.toString(16).toUpperCase()}`;
      console.log(`${frame.time},${hexId},${s.name},${raw},${value ?? ""}`);
    }
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
