// ============================================================
// AI TRADE ARENA — Decision Logger
//
// Stores structured audit trail for every decision the fusion
// engine makes. Every log entry records:
// - Which modules ran
// - What each module concluded
// - Which supported / contradicted / vetoed
// - The final decision and reasoning
// - Market snapshot at decision time
//
// Logs are kept in memory (last N entries) and can be
// queried for analysis and debugging.
// ============================================================

import type { DecisionLogEntry, FusionResult, FusionDecision, ModuleOutput } from "./modules/types";
import type { TradeSide, MarketRegime } from "./types";

export interface DecisionLoggerConfig {
  /** Maximum log entries to retain in memory. */
  maxEntries: number;
  /** Whether to also console.log structured entries. */
  consoleLogging: boolean;
}

const DEFAULT_LOGGER_CONFIG: DecisionLoggerConfig = {
  maxEntries: 500,
  consoleLogging: true,
};

export class DecisionLogger {
  private entries: DecisionLogEntry[] = [];
  private config: DecisionLoggerConfig;
  private counter = 0;

  constructor(config?: Partial<DecisionLoggerConfig>) {
    this.config = { ...DEFAULT_LOGGER_CONFIG, ...config };
  }

  /**
   * Log a fusion engine decision.
   * Returns the created log entry.
   */
  logDecision(params: {
    symbol: string;
    side: TradeSide;
    fusionResult: FusionResult;
    price: number;
    change24h: number;
    high24h: number;
    low24h: number;
    volume24h: number;
    regime: MarketRegime;
    tradeId: string | null;
  }): DecisionLogEntry {
    this.counter++;
    const entry: DecisionLogEntry = {
      logId: `log_${Date.now()}_${this.counter}`,
      symbol: params.symbol,
      side: params.side,
      decision: params.fusionResult.decision,
      confidence: params.fusionResult.confidence,
      uncertainty: params.fusionResult.uncertainty,
      vetoModules: params.fusionResult.vetoModules,
      supportingModules: params.fusionResult.modules
        .filter(m => m.direction !== "neutral" && m.confidence >= 0.2)
        .filter(m => {
          const aligned = m.direction === (params.side === "long" ? "bullish" : "bearish");
          return aligned;
        })
        .map(m => m.module),
      contradictingModules: params.fusionResult.modules
        .filter(m => m.direction !== "neutral" && m.confidence >= 0.2)
        .filter(m => {
          const aligned = m.direction === (params.side === "long" ? "bullish" : "bearish");
          return !aligned;
        })
        .map(m => m.module),
      neutralModules: params.fusionResult.modules
        .filter(m => m.direction === "neutral" || m.confidence < 0.2)
        .map(m => m.module),
      reasonCodes: params.fusionResult.reasonCodes,
      summary: params.fusionResult.summary,
      moduleOutputs: params.fusionResult.modules,
      marketSnapshot: {
        price: params.price,
        change24h: params.change24h,
        high24h: params.high24h,
        low24h: params.low24h,
        volume24h: params.volume24h,
        regime: params.regime,
      },
      timestamp: Date.now(),
      tradeId: params.tradeId,
    };

    this.entries.push(entry);

    // Trim old entries
    if (this.entries.length > this.config.maxEntries) {
      this.entries = this.entries.slice(-this.config.maxEntries);
    }

    // Console logging
    if (this.config.consoleLogging) {
      this.consoleLog(entry);
    }

    return entry;
  }

  private consoleLog(entry: DecisionLogEntry): void {
    const emoji = entry.decision === "BUY" ? "🟢" : entry.decision === "SELL" ? "🔴" : "⚪";
    const vetoStr = entry.vetoModules.length > 0 ? ` [VETO: ${entry.vetoModules.join(", ")}]` : "";

    console.group(`${emoji} [FUSION] ${entry.decision} ${entry.symbol} ${entry.side.toUpperCase()} — Confidence: ${(entry.confidence * 100).toFixed(1)}% — Uncertainty: ${(entry.uncertainty * 100).toFixed(1)}%${vetoStr}`);
    console.log(`Summary: ${entry.summary}`);
    console.log(`Modules: ${entry.supportingModules.length} supporting, ${entry.contradictingModules.length} contradicting, ${entry.neutralModules.length} neutral`);
    console.log(`Reason codes: ${entry.reasonCodes.join(", ")}`);
    if (entry.tradeId) console.log(`Trade opened: ${entry.tradeId}`);

    // Log each module's conclusion
    console.group("Module Breakdown");
    for (const mod of entry.moduleOutputs) {
      const icon = mod.veto ? "🚫" : mod.direction === "bullish" ? "📈" : mod.direction === "bearish" ? "📉" : "➖";
      console.log(`${icon} ${mod.module}: ${mod.direction} (str=${mod.strength.toFixed(2)}, conf=${mod.confidence.toFixed(2)}, unc=${mod.uncertainty.toFixed(2)})`);
      if (mod.vetoReason) console.log(`  VETO: ${mod.vetoReason}`);
    }
    console.groupEnd();

    console.groupEnd();
  }

  /** Get recent log entries. */
  getRecent(count = 20): DecisionLogEntry[] {
    return this.entries.slice(-count);
  }

  /** Get entries for a specific symbol. */
  getBySymbol(symbol: string, count = 20): DecisionLogEntry[] {
    return this.entries
      .filter(e => e.symbol === symbol)
      .slice(-count);
  }

  /** Get entries filtered by decision type. */
  getByDecision(decision: FusionDecision, count = 20): DecisionLogEntry[] {
    return this.entries
      .filter(e => e.decision === decision)
      .slice(-count);
  }

  /** Get statistics about logged decisions. */
  getStats(): {
    totalDecisions: number;
    buyDecisions: number;
    sellDecisions: number;
    noTradeDecisions: number;
    vetoRate: number;
    avgConfidence: number;
    avgUncertainty: number;
    topVetoModules: Record<string, number>;
    topReasonCodes: Record<string, number>;
  } {
    const total = this.entries.length;
    const buys = this.entries.filter(e => e.decision === "BUY").length;
    const sells = this.entries.filter(e => e.decision === "SELL").length;
    const noTrades = this.entries.filter(e => e.decision === "NO_TRADE").length;
    const vetoed = this.entries.filter(e => e.vetoModules.length > 0).length;

    const avgConf = total > 0 ? this.entries.reduce((s, e) => s + e.confidence, 0) / total : 0;
    const avgUnc = total > 0 ? this.entries.reduce((s, e) => s + e.uncertainty, 0) / total : 0;

    const vetoCounts: Record<string, number> = {};
    const reasonCounts: Record<string, number> = {};
    for (const e of this.entries) {
      for (const v of e.vetoModules) vetoCounts[v] = (vetoCounts[v] ?? 0) + 1;
      for (const r of e.reasonCodes) reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
    }

    return {
      totalDecisions: total,
      buyDecisions: buys,
      sellDecisions: sells,
      noTradeDecisions: noTrades,
      vetoRate: total > 0 ? vetoed / total : 0,
      avgConfidence: avgConf,
      avgUncertainty: avgUnc,
      topVetoModules: vetoCounts,
      topReasonCodes: reasonCounts,
    };
  }

  /** Clear all entries. */
  clear(): void {
    this.entries = [];
    this.counter = 0;
  }
}

// ── Module-level singleton ──
export const decisionLogger = new DecisionLogger();
