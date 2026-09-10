import { motion } from "framer-motion";
import { 
  TrendingUp, 
  Shield, 
  Brain, 
  BarChart3, 
  Zap, 
  Lock,
  ArrowRight,
  ChevronRight,
  LineChart,
  Activity,
  Target
} from "lucide-react";
import { Link } from "react-router";
import logo from "@/assets/logo.svg";

const features = [
  {
    icon: Brain,
    title: "AI-Powered Learning",
    description: "Our bot learns from every trade, adapting to market conditions and improving its decision-making over time.",
    color: "from-violet-500 to-purple-600"
  },
  {
    icon: Shield,
    title: "Advanced Risk Engine",
    description: "Independent risk management layer that validates every trade against portfolio limits, drawdowns, and exposure rules.",
    color: "from-emerald-500 to-teal-600"
  },
  {
    icon: LineChart,
    title: "Momentum Breakout Strategy",
    description: "Captures trending moves with volatility expansion, breakout confirmation, and multi-timeframe analysis.",
    color: "from-blue-500 to-cyan-600"
  },
  {
    icon: BarChart3,
    title: "Comprehensive Backtesting",
    description: "Walk-forward testing, Monte Carlo analysis, and regime-specific performance metrics.",
    color: "from-orange-500 to-amber-600"
  },
  {
    icon: Target,
    title: "Precision Execution",
    description: "Configurable slippage, spread, and commission models for realistic performance estimation.",
    color: "from-rose-500 to-pink-600"
  },
  {
    icon: Activity,
    title: "Real-Time Analytics",
    description: "Live performance dashboards with Sharpe ratio, win rate, expectancy, and drawdown tracking.",
    color: "from-indigo-500 to-blue-600"
  }
];

const stats = [
  { value: "15m", label: "Primary Timeframe" },
  { value: "0.5%", label: "Risk Per Trade" },
  { value: "2:1", label: "Reward:Risk" },
  { value: "20", label: "Breakout Period" }
];

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 }
};

export default function Landing() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white overflow-hidden">
      {/* Ambient background effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-blue-500/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-violet-500/5 rounded-full blur-[120px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-emerald-500/3 rounded-full blur-[150px]" />
      </div>

      {/* Navigation */}
      <nav className="relative z-10 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={logo} alt="QuantumFlow" className="w-8 h-8" />
            <span className="text-lg font-semibold tracking-tight">QuantumFlow</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="#features" className="text-sm text-zinc-400 hover:text-white transition-colors">
              Features
            </a>
            <a href="#strategy" className="text-sm text-zinc-400 hover:text-white transition-colors">
              Strategy
            </a>
            <a href="#metrics" className="text-sm text-zinc-400 hover:text-white transition-colors">
              Metrics
            </a>
            <Link
              to="/auth"
              className="px-4 py-2 text-sm font-medium bg-white/10 hover:bg-white/15 rounded-lg transition-all border border-white/10"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative z-10 pt-20 pb-32 px-6">
        <div className="max-w-5xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 mb-8">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span className="text-xs text-blue-400 font-medium">Quantitative Trading System</span>
            </div>
            
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6">
              <span className="bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
                Trade Smarter
              </span>
              <br />
              <span className="bg-gradient-to-r from-blue-400 via-violet-400 to-purple-400 bg-clip-text text-transparent">
                With AI
              </span>
            </h1>
            
            <p className="text-lg md:text-xl text-zinc-400 max-w-2xl mx-auto mb-10 leading-relaxed">
              A systematic trading bot that learns from market behavior, 
              manages risk with precision, and adapts to changing conditions.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                to="/auth"
                className="group px-8 py-3.5 bg-white text-black font-semibold rounded-xl hover:bg-zinc-200 transition-all flex items-center gap-2"
              >
                Start Building
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
              <a
                href="#strategy"
                className="px-8 py-3.5 bg-white/5 border border-white/10 font-medium rounded-xl hover:bg-white/10 transition-all text-zinc-300"
              >
                View Strategy
              </a>
            </div>
          </motion.div>

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-8"
          >
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-3xl font-bold text-white mb-1">{stat.value}</div>
                <div className="text-sm text-zinc-500">{stat.label}</div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="relative z-10 py-32 px-6 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Built for Systematic Traders
            </h2>
            <p className="text-zinc-400 max-w-xl mx-auto">
              Every component designed with institutional-grade risk management and AI-powered learning at its core.
            </p>
          </motion.div>

          <motion.div
            variants={container}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="grid md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {features.map((feature) => (
              <motion.div
                key={feature.title}
                variants={item}
                className="group relative p-6 rounded-2xl bg-white/[0.02] border border-white/[0.05] hover:border-white/[0.1] transition-all"
              >
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${feature.color} p-[1px] mb-5`}>
                  <div className="w-full h-full rounded-[11px] bg-[#0a0a0f] flex items-center justify-center">
                    <feature.icon className="w-5 h-5 text-white" />
                  </div>
                </div>
                <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{feature.description}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Strategy Section */}
      <section id="strategy" className="relative z-10 py-32 px-6 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
            >
              <h2 className="text-3xl md:text-4xl font-bold mb-6">
                Trend + Breakout + Momentum
              </h2>
              <p className="text-zinc-400 mb-8 leading-relaxed">
                Our baseline strategy captures directional moves after strong breakouts from consolidation, 
                confirmed by higher-timeframe alignment and volatility expansion.
              </p>
              
              <div className="space-y-4">
                {[
                  "Multi-timeframe trend alignment (1H → 15M)",
                  "Donchian breakout confirmation",
                  "RSI momentum filter (55-75 range)",
                  "ATR-based dynamic stops and targets",
                  "Intelligent trailing after +2R",
                  "Time-based exits for stale positions"
                ].map((item) => (
                  <div key={item} className="flex items-start gap-3">
                    <ChevronRight className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" />
                    <span className="text-sm text-zinc-300">{item}</span>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
              className="relative"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-violet-500/10 rounded-3xl blur-xl" />
              <div className="relative bg-[#111118] border border-white/[0.08] rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between pb-4 border-b border-white/[0.05]">
                  <span className="text-sm font-medium text-zinc-300">Entry Conditions</span>
                  <span className="text-xs px-2 py-1 bg-emerald-500/10 text-emerald-400 rounded-full">All Required</span>
                </div>
                {[
                  { label: "1H EMA50 > EMA200", check: true },
                  { label: "1H Close > EMA50", check: true },
                  { label: "15M Breakout (N=20)", check: true },
                  { label: "RSI 14: 55 < RSI < 75", check: true },
                  { label: "Volume > 1.2x MA", check: true },
                  { label: "No Existing Position", check: true }
                ].map((condition) => (
                  <div key={condition.label} className="flex items-center justify-between py-2">
                    <span className="text-sm text-zinc-400">{condition.label}</span>
                    <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Metrics Section */}
      <section id="metrics" className="relative z-10 py-32 px-6 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Comprehensive Performance Analytics
            </h2>
            <p className="text-zinc-400 max-w-xl mx-auto">
              Every trade is auditable. Every metric is calculated with realistic cost assumptions.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="grid grid-cols-2 md:grid-cols-4 gap-4"
          >
            {[
              { label: "Sharpe Ratio", description: "Risk-adjusted returns" },
              { label: "Sortino Ratio", description: "Downside risk focus" },
              { label: "Calmar Ratio", description: "Return vs drawdown" },
              { label: "Profit Factor", description: "Gross win/loss" },
              { label: "Win Rate", description: "Percentage of winners" },
              { label: "Expectancy", description: "Expected value per trade" },
              { label: "Max Drawdown", description: "Worst peak-to-trough" },
              { label: "Recovery Time", description: "Drawdown duration" }
            ].map((metric) => (
              <div
                key={metric.label}
                className="p-5 rounded-xl bg-white/[0.02] border border-white/[0.05]"
              >
                <div className="text-lg font-semibold mb-1">{metric.label}</div>
                <div className="text-sm text-zinc-500">{metric.description}</div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative z-10 py-32 px-6 border-t border-white/5">
        <div className="max-w-4xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-6">
              Ready to Build Your Trading Edge?
            </h2>
            <p className="text-zinc-400 mb-10 max-w-xl mx-auto">
              Start with paper trading, validate your strategy, and deploy with confidence.
            </p>
            <Link
              to="/auth"
              className="inline-flex items-center gap-2 px-10 py-4 bg-white text-black font-semibold rounded-xl hover:bg-zinc-200 transition-all text-lg"
            >
              Get Started Free
              <ArrowRight className="w-5 h-5" />
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 py-8 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <img src={logo} alt="QuantumFlow" className="w-4 h-4 opacity-50" />
            © 2024 QuantumFlow
          </div>
          <div className="text-xs text-zinc-600">
            For research and educational purposes only
          </div>
        </div>
      </footer>
    </div>
  );
}
