import {
  type Candle,
  type CandleKey,
  type Interval,
  INTERVAL_MS,
  alignTime,
  candleId,
  isValidCandle,
} from "./types";

/**
 * CandleStore — per (symbol, interval) state with:
 *  - forming vs closed candle distinction (§6)
 *  - duplicate protection via candleId (§14)
 *  - out-of-order guard: stale events never overwrite newer data (§15)
 *  - gap detection against aligned boundaries (§13)
 *  - backfill merge that never corrupts history (§4, §13)
 */
export class CandleStore {
  private closedCandles: Candle[] = []; // immutable once closed
  private forming: Candle | null = null;
  private lastEventTime = 0;
  private seenClosedIds = new Set<string>();
  private maxCandles: number;

  readonly key: CandleKey;

  constructor(key: CandleKey, maxCandles = 720) {
    this.key = key;
    this.maxCandles = maxCandles;
  }

  get closed(): readonly Candle[] {
    return this.closedCandles;
  }

  get formingCandle(): Candle | null {
    return this.forming ? { ...this.forming } : null;
  }

  /** All candles ascending, forming candle last (mutating copy). */
  all(): Candle[] {
    const out = [...this.closedCandles];
    if (this.forming) out.push({ ...this.forming });
    return out;
  }

  get lastEventTs(): number {
    return this.lastEventTime;
  }

  get latest(): Candle | null {
    if (this.forming) return { ...this.forming };
    return this.closedCandles.length ? { ...this.closedCandles[this.closedCandles.length - 1] } : null;
  }

  get latestClosed(): Candle | null {
    return this.closedCandles.length ? { ...this.closedCandles[this.closedCandles.length - 1] } : null;
  }

  /** Seed from REST history. Must be ascending, all closed, boundary-aligned. */
  seedFromHistory(candles: Candle[]): { seeded: number; rejected: number } {
    let seeded = 0;
    let rejected = 0;
    for (const raw of candles) {
      const c: Candle = { ...raw, closed: true };
      if (!isValidCandle(c)) { rejected++; continue; }
      if (c.time % INTERVAL_MS[this.key.interval] !== 0) { rejected++; continue; }
      const id = candleId(this.key.symbol, this.key.interval, c.time);
      if (this.seenClosedIds.has(id)) { rejected++; continue; }
      // If a forming candle exists for the same period, merge (REST may be newer)
      if (this.forming && this.forming.time === c.time) {
        // keep forming as-is (live is authoritative)
        rejected++;
        continue;
      }
      this.closedCandles.push(c);
      this.seenClosedIds.add(id);
      seeded++;
      if (c.time > this.lastEventTime) this.lastEventTime = c.time + INTERVAL_MS[this.key.interval];
    }
    this.closedCandles.sort((a, b) => a.time - b.time);
    this.trim();
    return { seeded, rejected };
  }

  /**
   * Apply a normalized kline event (live stream).
   * Returns "updated" | "closed" | "created" | "ignored".
   */
  applyKline(incoming: Candle, eventTime: number):
    { status: "updated" | "closed" | "created" | "ignored"; gapDetected: boolean } {
    if (!isValidCandle(incoming)) return { status: "ignored", gapDetected: false };

    const aligned = alignTime(incoming.time, this.key.interval);
    if (aligned !== incoming.time) return { status: "ignored", gapDetected: false };

    let gapDetected = false;

    // Out-of-order guard: never let stale events overwrite newer state (§15)
    if (eventTime < this.lastEventTime - INTERVAL_MS[this.key.interval]) {
      // Event older than last seen — safe-handled below depending on closed/forming target.
    }

    // Case 1: incoming is for the currently forming candle
    if (this.forming && incoming.time === this.forming.time) {
      // Exchange kline for the same period — authoritative update
      this.forming = { ...incoming, closed: false };
      this.lastEventTime = Math.max(this.lastEventTime, eventTime);
      return { status: "updated", gapDetected };
    }

    // Case 2: incoming period is the NEXT candle → close current, open new
    if (incoming.time > (this.forming?.time ?? -Infinity)) {
      // If exchange marks this candle closed but we have it as forming → finalize first
      if (this.forming) {
        const finalized: Candle = { ...this.forming, closed: true };
        const fid = candleId(this.key.symbol, this.key.interval, finalized.time);
        if (!this.seenClosedIds.has(fid)) {
          this.closedCandles.push(finalized);
          this.seenClosedIds.add(fid);
        }
        this.forming = null;
      }

      // Gap detection: did we skip one or more boundaries? (§13)
      const expectedNext = this.closedCandles.length
        ? this.closedCandles[this.closedCandles.length - 1].time + INTERVAL_MS[this.key.interval]
        : incoming.time;
      if (this.closedCandles.length > 0 && incoming.time > expectedNext) {
        gapDetected = true;
      }

      if (incoming.closed) {
        // Whole candle arrived closed (e.g., after reconnect/backfill)
        const id = candleId(this.key.symbol, this.key.interval, incoming.time);
        if (!this.seenClosedIds.has(id)) {
          this.closedCandles.push({ ...incoming, closed: true });
          this.seenClosedIds.add(id);
          this.lastEventTime = Math.max(this.lastEventTime, eventTime);
          return { status: "closed", gapDetected };
        }
        return { status: "ignored", gapDetected };
      }

      // New forming candle
      this.forming = { ...incoming, closed: false };
      this.lastEventTime = Math.max(this.lastEventTime, eventTime);
      return { status: "created", gapDetected };
    }

    // Case 3: incoming is for an older, already-closed candle → repair if materially different
    const existing = this.closedCandles.find(c => c.time === incoming.time);
    if (existing) {
      const materiallyDifferent =
        Math.abs(existing.open - incoming.open) > 1e-9 ||
        Math.abs(existing.close - incoming.close) > 1e-9 ||
        incoming.high > existing.high + 1e-9 ||
        incoming.low < existing.low - 1e-9 ||
        incoming.volume > existing.volume + 1e-9;
      if (materiallyDifferent && incoming.closed) {
        const idx = this.closedCandles.indexOf(existing);
        this.closedCandles[idx] = { ...incoming, closed: true };
        return { status: "closed", gapDetected };
      }
    }

    return { status: "ignored", gapDetected };
  }

  /** Merge backfilled (closed) candles fetched after a reconnect. */
  mergeBackfill(candles: Candle[]): { merged: number; gapsFilled: number } {
    let merged = 0;
    let gapsFilled = 0;

    const valid = candles
      .filter(c => isValidCandle(c) && c.time % INTERVAL_MS[this.key.interval] === 0)
      .sort((a, b) => a.time - b.time);

    for (const c of valid) {
      const id = candleId(this.key.symbol, this.key.interval, c.time);
      const closedCandle: Candle = { ...c, closed: true };

      if (this.forming && c.time === this.forming.time) continue; // live is authoritative

      const existingIdx = this.closedCandles.findIndex(x => x.time === c.time);
      if (existingIdx >= 0) {
        // Repair historical candle if REST data is materially different
        const existing = this.closedCandles[existingIdx];
        if (
          Math.abs(existing.open - closedCandle.open) > 1e-9 ||
          Math.abs(existing.close - closedCandle.close) > 1e-9 ||
          closedCandle.high > existing.high + 1e-9 ||
          closedCandle.low < existing.low - 1e-9 ||
          closedCandle.volume > existing.volume + 1e-9
        ) {
          this.closedCandles[existingIdx] = closedCandle;
          merged++;
        }
        continue;
      }

      // Insert preserving ascending order
      this.closedCandles.push(closedCandle);
      this.seenClosedIds.add(id);
      merged++;

      if (c.time > this.lastEventTime && !this.forming) {
        this.lastEventTime = c.time + INTERVAL_MS[this.key.interval];
      }
    }

    this.closedCandles.sort((a, b) => a.time - b.time);

    // Recount gaps after merge
    for (let i = 1; i < this.closedCandles.length; i++) {
      if (this.closedCandles[i].time - this.closedCandles[i - 1].time !== INTERVAL_MS[this.key.interval]) {
        gapsFilled++;
      }
    }

    this.trim();
    return { merged, gapsFilled };
  }

  /** Finalize the forming candle if its period has ended (wall/server clock driven). */
  finalizeIfPeriodEnded(nowMs: number): Candle | null {
    if (!this.forming) return null;
    const endTime = this.forming.time + INTERVAL_MS[this.key.interval];
    if (nowMs >= endTime) {
      const finalized: Candle = { ...this.forming, closed: true };
      const fid = candleId(this.key.symbol, this.key.interval, finalized.time);
      if (!this.seenClosedIds.has(fid)) {
        this.closedCandles.push(finalized);
        this.seenClosedIds.add(fid);
      }
      this.forming = null;
      return finalized;
    }
    return null;
  }

  private trim(): void {
    if (this.closedCandles.length > this.maxCandles) {
      const removed = this.closedCandles.length - this.maxCandles;
      const removedCandles = this.closedCandles.slice(0, removed);
      for (const c of removedCandles) {
        this.seenClosedIds.delete(candleId(this.key.symbol, this.key.interval, c.time));
      }
      this.closedCandles.splice(0, removed);
    }
  }
}

/** Registry of stores keyed by symbol|interval (§16, §17). */
export class CandleManager {
  private stores = new Map<string, CandleStore>();

  getStore(symbol: string, interval: Interval): CandleStore {
    const k = `${symbol}|${interval}`;
    let s = this.stores.get(k);
    if (!s) {
      s = new CandleStore({ symbol, interval });
      this.stores.set(k, s);
    }
    return s;
  }

  keys(): string[] {
    return [...this.stores.keys()];
  }
}
