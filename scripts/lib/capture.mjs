// Capture file reading shared by decode.mjs and check-captures.mjs.
// Accepts plain or .gz files in any of these formats (auto-detected per line):
//   KDMLink recorder CSV   1782174769580,0x366,870,7,5C D0 1E 5C 04 76 00
//   candump -l             (1718000000.123456) can0 316#0011223344556677
//   candump                can0  316   [8]  00 11 22 33 44 55 66 77
//   SavvyCAN / GVRET CSV   Time Stamp,ID,Extended,Dir,Bus,LEN,D1,...,D8

import { createReadStream } from "node:fs";
import readline from "node:readline";
import { createGunzip } from "node:zlib";

export function parseLine(line) {
  let m = line.match(/^\s*\(([\d.]+)\)\s+\S+\s+([0-9A-Fa-f]+)#([0-9A-Fa-f]*)/);
  if (m) return { time: m[1], timeMs: Number(m[1]) * 1000, canId: parseInt(m[2], 16), data: hexBytes(m[3]) };

  m = line.match(/^\s*\S+\s+([0-9A-Fa-f]{1,8})\s+\[(\d)\]\s+((?:[0-9A-Fa-f]{2}\s*)*)$/);
  if (m) return { time: "", timeMs: null, canId: parseInt(m[1], 16), data: hexBytes(m[3].replace(/\s+/g, "")) };

  m = line.match(/^\s*(\d+),0x([0-9A-Fa-f]+),\d+,(\d+),((?:[0-9A-Fa-f]{2}\s*)*)$/);
  if (m) return { time: m[1], timeMs: Number(m[1]), canId: parseInt(m[2], 16), data: hexBytes(m[4].replace(/\s+/g, "")) };

  const cols = line.split(",").map((c) => c.trim());
  if (cols.length >= 7 && /^(0x)?[0-9A-Fa-f]+$/.test(cols[1]) && /^\d+$/.test(cols[5])) {
    const len = Number(cols[5]);
    const data = cols.slice(6, 6 + len).map((b) => parseInt(b, 16));
    if (data.every(Number.isInteger)) {
      // GVRET timestamps are microseconds.
      return { time: cols[0], timeMs: Number(cols[0]) / 1000, canId: parseInt(cols[1].replace(/^0x/i, ""), 16), data };
    }
  }
  return null;
}

function hexBytes(hex) {
  const out = [];
  for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

/** Async iterator of frames {time, timeMs, canId, data} from a capture file. */
export async function* readFrames(file) {
  let input = createReadStream(file);
  if (file.endsWith(".gz")) input = input.pipe(createGunzip());
  for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) {
    const frame = parseLine(line);
    if (frame) yield frame;
  }
}
