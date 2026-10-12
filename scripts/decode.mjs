#!/usr/bin/env node
// Decode a CAN capture with a vehicle config, the same way the app does.
// Prints CSV: time,canId,signal,raw,value  (value is empty when the app would
// drop the sample: ignoredRawValues hit or outside minValue..maxValue).
//
//   node scripts/decode.mjs <vehicle-id> <capture> [--signals EngineRPM,BoostPressurePsi]
//   node scripts/decode.mjs --list <vehicle-id>
//
// Capture formats (auto-detected per line):
//   KDMLink recorder CSV   1782174769580,0x366,870,7,5C D0 1E 5C 04 76 00
//   candump -l       (1718000000.123456) can0 316#0011223344556677
//   candump          can0  316   [8]  00 11 22 33 44 55 66 77
//   SavvyCAN / GVRET CSV   Time Stamp,ID,Extended,Dir,Bus,LEN,D1,...,D8

import { createReadStream } from "node:fs";
import readline from "node:readline";
import { composeLeaf, decodeSignal, extractRaw } from "./lib/vehicles.mjs";

function parseLine(line) {
  let m = line.match(/^\s*\(([\d.]+)\)\s+\S+\s+([0-9A-Fa-f]+)#([0-9A-Fa-f]*)/);
  if (m) return { time: m[1], canId: parseInt(m[2], 16), data: hexBytes(m[3]) };

  m = line.match(/^\s*\S+\s+([0-9A-Fa-f]{1,8})\s+\[(\d)\]\s+((?:[0-9A-Fa-f]{2}\s*)*)$/);
  if (m) return { time: "", canId: parseInt(m[1], 16), data: hexBytes(m[3].replace(/\s+/g, "")) };

  m = line.match(/^\s*(\d+),0x([0-9A-Fa-f]+),\d+,(\d+),((?:[0-9A-Fa-f]{2}\s*)*)$/);
  if (m) return { time: m[1], canId: parseInt(m[2], 16), data: hexBytes(m[4].replace(/\s+/g, "")) };

  const cols = line.split(",").map((c) => c.trim());
  if (cols.length >= 7 && /^(0x)?[0-9A-Fa-f]+$/.test(cols[1]) && /^\d+$/.test(cols[5])) {
    const len = Number(cols[5]);
    const data = cols.slice(6, 6 + len).map((b) => parseInt(b, 16));
    if (data.every(Number.isInteger)) {
      return { time: cols[0], canId: parseInt(cols[1].replace(/^0x/i, ""), 16), data };
    }
  }
  return null;
}

function hexBytes(hex) {
  const out = [];
  for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

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
  const lines = readline.createInterface({ input: createReadStream(file) });
  for await (const line of lines) {
    const frame = parseLine(line);
    if (!frame) continue;
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
