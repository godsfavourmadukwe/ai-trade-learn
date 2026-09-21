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
// Only the frames' numeric/string leaves are decoded — no
// protobuf library dependency is needed.
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

/** Minimal protobuf wire-format reader for PricingData frames. */
export function decodePricingData(bytes: Uint8Array): Partial<StreamTick> {
  const buf = Buffer.from(bytes);
  const out: Record<string, unknown> = {};
  let i = 0;

  const readVarint = (): bigint => {
    let shift = 0;
    let val = 0n;
    for (;;) {
      const b = buf[i++];
      val |= BigInt(b & 0x7f) << BigInt(shift);
      shift += 7;
      if ((b & 0x80) === 0) break;
      if (shift > 70) throw new Error("protobuf varint too long");
    }
    return val;
  };

  while (i < buf.length) {
    const tag = buf[i++];
    const field = tag >> 3;
    const wire = tag & 7;

    switch (wire) {
      case 0: {
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
        out[field] = buf.readDoubleLE(i);
        i += 8;
        break;
      }
      case 5: {
        out[field] = buf.readFloatLE(i);
        i += 4;
        break;
      }
      case 2: {
        const len = buf[i++];
        out[field] = Buffer.from(buf.subarray(i, i + len)).toString("utf8");
        i += len;
        break;
      }
      default:
        // unknown wire type — cannot safely continue
        i = buf.length;
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
      const bytes = Buffer.from(frame, "base64");
      if (bytes.length === 0) continue;
      const decoded = decodePricingData(new Uint8Array(bytes));
      if (typeof decoded.id === "string" && typeof decoded.price === "number" && Number.isFinite(decoded.price)) {
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
