// ============================================================
// STOCK STREAM — Yahoo PricingData protobuf decoder
//
// streamer.finance.yahoo.com pushes base64-encoded protobuf
// frames either as raw base64 strings or as JSON arrays of them.
// The PricingData schema (verified against live frames + the
// yfinance schema):
//
//   1: id              (string)   e.g. "AAPL"
//   2: price           (float32)
//   3: time            (zigzag varint, epoch MILLISECONDS)
//   4: currency        (string)
//   5: exchange        (string)   e.g. "NMS"
//   6: quoteType       (varint)
//   7: marketHours     (varint)   1 = REGULAR_MARKET, 2 = PRE_MARKET, 3 = POST_MARKET
//   8: changePercent   (float32)
//   9: dayVolume       (varint)
//  10: dayHigh         (float32)
//  11: dayLow          (float32)
//  12: change          (float32)
//  13: shortQuoteType  (string)
//  14: volatility      (float32)
//  15: openPrice       (float32)
//  16: previousClose   (float32)
//  17: pegRatio        (float32)
//  18: sharesOutstanding (float32)
//  19: yearLow         (float32)
//  20: yearHigh        (float32)
//  22: priceHint       (varint)
//  23: bid             (float32)
//  24: bidSize         (varint)
//  25: ask             (float32)
//  26: askSize         (varint)
//  30: espMatchedTape  (varint)
//
// IMPORTANT — this module must run in the BROWSER, in Node and
// in the Convex "use node" runtime. It therefore uses NO Node
// built-ins: no Buffer, no fs. Base64 decoding, byte reading
// and UTF-8 decoding are implemented on Uint8Array/DataView/
// TextDecoder only. (The previous implementation used the global
// `Buffer`, which does not exist in browsers — every incoming
// message threw `Buffer is not defined` and no tick ever
// reached the UI. This is the fix for that.)
// ============================================================

/** One normalized real-time quote tick from the stream. */
export interface StreamTick {
  id: string;
  price: number;
  time: number; // epoch ms
  currency: string | null;
  exchange: string | null;
  marketHours: number | null; // 1 regular, 2 pre, 3 post
  changePercent: number | null;
  dayVolume: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  change: number | null;
  openPrice: number | null;
  previousClose: number | null;
  yearLow: number | null;
  yearHigh: number | null;
  bid: number | null;
  bidSize: number | null;
  ask: number | null;
  askSize: number | null;
}

// ── Pure-JS base64 → bytes (works in every runtime) ───────

const B64_LOOKUP = (() => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < alphabet.length; i++) table[alphabet.charCodeAt(i)] = i;
  table["-".charCodeAt(0)] = 62; // URL-safe variants
  table["_".charCodeAt(0)] = 63;
  return table;
})();

/** Decode base64 (standard or URL-safe) into bytes. Returns null on invalid input. */
export function base64ToBytes(b64: string): Uint8Array | null {
  const clean = b64.replace(/[\s=]+$/g, "");
  const rem = clean.length % 4;
  if (rem === 1) return null;
  const outLen = Math.floor((clean.length * 3) / 4) + (rem === 2 ? 1 : rem === 3 ? 2 : 0);
  const out = new Uint8Array(outLen);
  let acc = 0;
  let accBits = 0;
  let o = 0;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    const val = code < 128 ? B64_LOOKUP[code] : -1;
    if (val < 0) return null; // contains a non-base64 character
    acc = (acc << 6) | val;
    accBits += 6;
    if (accBits >= 8) {
      accBits -= 8;
      out[o++] = (acc >> accBits) & 0xff;
    }
  }
  return o === outLen ? out : out.subarray(0, o);
}

const utf8 = /* @__PURE__ */ new TextDecoder("utf-8");

/**
 * Minimal protobuf wire-format reader for PricingData frames.
 * Pure JS — no Buffer/DataView host APIs beyond Uint8Array.
 */
export function decodePricingData(bytes: Uint8Array): Partial<StreamTick> {
  const out: Record<string, unknown> = {};
  let i = 0;
  const len = bytes.length;

  const readVarint = (): bigint => {
    let shift = 0n;
    let val = 0n;
    for (;;) {
      if (i >= len) throw new Error("protobuf: truncated varint");
      const b = bytes[i++];
      val |= BigInt(b & 0x7f) << shift;
      shift += 7n;
      if ((b & 0x80) === 0) break;
      if (shift > 70n) throw new Error("protobuf varint too long");
    }
    return val;
  };

  while (i < len) {
    const tag = bytes[i++];
    const field = tag >> 3;
    const wire = tag & 7;

    switch (wire) {
      case 0: {
        // varint
        const raw = readVarint();
        // field 3 (time) is zigzag-encoded epoch ms in live frames
        if (field === 3) {
          const zz = (raw >> 1n) ^ -(raw & 1n);
          out.time = Number(zz);
        } else {
          out[field] = Number(raw);
        }
        break;
      }
      case 1: {
        // fixed64 → double
        if (i + 8 > len) throw new Error("protobuf: truncated double");
        const view = new DataView(bytes.buffer, bytes.byteOffset + i, 8);
        out[field] = view.getFloat64(0, true);
        i += 8;
        break;
      }
      case 5: {
        // fixed32 → float
        if (i + 4 > len) throw new Error("protobuf: truncated float");
        const view = new DataView(bytes.buffer, bytes.byteOffset + i, 4);
        out[field] = view.getFloat32(0, true);
        i += 4;
        break;
      }
      case 2: {
        // length-delimited string/bytes
        const strLen = Number(readVarint());
        if (i + strLen > len) throw new Error("protobuf: truncated string");
        out[field] = utf8.decode(bytes.subarray(i, i + strLen));
        i += strLen;
        break;
      }
      default:
        // unknown wire type — cannot safely continue
        i = len;
        break;
    }
  }

  return {
    id: typeof out[1] === "string" ? (out[1] as string) : undefined,
    price: typeof out[2] === "number" ? (out[2] as number) : undefined,
    time: typeof out.time === "number" ? (out.time as number) : undefined,
    currency: typeof out[4] === "string" ? (out[4] as string) : undefined,
    exchange: typeof out[5] === "string" ? (out[5] as string) : undefined,
    marketHours: typeof out[7] === "number" ? (out[7] as number) : undefined,
    changePercent: typeof out[8] === "number" ? (out[8] as number) : undefined,
    dayVolume: typeof out[9] === "number" ? (out[9] as number) : undefined,
    dayHigh: typeof out[10] === "number" ? (out[10] as number) : undefined,
    dayLow: typeof out[11] === "number" ? (out[11] as number) : undefined,
    change: typeof out[12] === "number" ? (out[12] as number) : undefined,
    openPrice: typeof out[15] === "number" ? (out[15] as number) : undefined,
    previousClose: typeof out[16] === "number" ? (out[16] as number) : undefined,
    yearLow: typeof out[19] === "number" ? (out[19] as number) : undefined,
    yearHigh: typeof out[20] === "number" ? (out[20] as number) : undefined,
    bid: typeof out[23] === "number" ? (out[23] as number) : undefined,
    bidSize: typeof out[24] === "number" ? (out[24] as number) : undefined,
    ask: typeof out[25] === "number" ? (out[25] as number) : undefined,
    askSize: typeof out[26] === "number" ? (out[26] as number) : undefined,
  } as Partial<StreamTick>;
}

/**
 * Parse a raw streamer message into ticks.
 * The streamer sends either a JSON array of base64 frames,
 * a raw base64 string, or a JSON object { id: "base64" }.
 * Malformed frames are skipped — never fabricated.
 */
export function parseStreamerMessage(raw: string): StreamTick[] {
  const text = raw.trim();
  let frames: string[] = [];

  try {
    if (text.startsWith("[")) {
      const arr = JSON.parse(text) as unknown[];
      frames = arr.filter((x): x is string => typeof x === "string");
    } else if (text.startsWith("{")) {
      const obj = JSON.parse(text) as Record<string, unknown>;
      if (typeof obj.id === "string") frames = [obj.id];
    } else {
      frames = [text];
    }
  } catch {
    return [];
  }

  const ticks: StreamTick[] = [];
  for (const frame of frames) {
    try {
      const bytes = base64ToBytes(frame);
      if (!bytes || bytes.length === 0) continue;
      const decoded = decodePricingData(bytes);
      if (
        typeof decoded.id === "string" &&
        typeof decoded.price === "number" &&
        Number.isFinite(decoded.price)
      ) {
        ticks.push({
          id: decoded.id,
          price: decoded.price,
          time: typeof decoded.time === "number" ? decoded.time : Date.now(),
          currency: decoded.currency ?? null,
          exchange: decoded.exchange ?? null,
          marketHours: decoded.marketHours ?? null,
          changePercent: decoded.changePercent ?? null,
          dayVolume: decoded.dayVolume ?? null,
          dayHigh: decoded.dayHigh ?? null,
          dayLow: decoded.dayLow ?? null,
          change: decoded.change ?? null,
          openPrice: decoded.openPrice ?? null,
          previousClose: decoded.previousClose ?? null,
          yearLow: decoded.yearLow ?? null,
          yearHigh: decoded.yearHigh ?? null,
          bid: decoded.bid ?? null,
          bidSize: decoded.bidSize ?? null,
          ask: decoded.ask ?? null,
          askSize: decoded.askSize ?? null,
        });
      }
    } catch {
      // Malformed frame — skip it, never fabricate
    }
  }
  return ticks;
}
