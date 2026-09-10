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
  Target,
  Sparkles,
  Globe,
  Layers
} from "lucide-react";
import { Link } from "react-router";
import logo from "@/assets/logo.svg";

const features = [
  {
    icon: Brain,
    title: "Pattern Recognition",
    description: "Our AI continuously learns from market behavior, identifying profitable patterns across multiple currency pairs.",
    gradient: "from-violet-500 to-purple-600"
  },
  {
    icon: Sparkles,
    title: "Smart Recommendations",
    description: "Receive data-driven trade recommendations based on real-time analysis and historical pattern matching.",
    gradient: "from-amber-500 to-orange-600"
  },
  {
    icon: Shield,
    title: "Risk Protection",
    description: "Advanced risk management with dynamic stop-losses, position sizing, and portfolio-level exposure controls.",
    gradient: "from-emerald-500 to-teal-600"
  },
  {
    icon: Globe,
    title: "Multi-Pair Coverage",
    description: "Trade across dozens of cryptocurrency pairs with deep liquidity analysis and correlation awareness.",
    gradient: "from-blue-500 to-cyan-600"
  },
  {
    icon: LineChart,
    title: "Backtesting Suite",
    description: "Test strategies against historical data with walk-forward optimization and regime-aware analysis.",
    gradient: "from-rose-500 to-pink-600"
  },
  {
    icon: Layers,
    title: "Live Market View",
    description: "Real-time price feeds, technical indicators, and market regime detection across all your pairs.",
    gradient: "from-indigo-500 to-violet-600"
  }
];

const currencyPairs = [
  { symbol: "BTC/USDT", name: "Bitcoin", change: "+2.45%", positive: true },
  { symbol: "ETH/USDT", name: "Ethereum", change: "+3.12%", positive: true },
  { symbol: "SOL/USDT", name: "Solana", change: "-1.23%", positive: false },
  { symbol: "BNB/USDT", name: "BNB", change: "+0.89%", positive: true },
  { symbol: "XRP/USDT", name: "XRP", change: "+1.56%", positive: true },
  { symbol: "ADA/USDT", name: "Cardano", change: "-0.67%", positive: false },
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
    <div className="min-h-screen bg-gradient-to-br from-[#0a0a12] via-[#0d0d1a] to-[#0a0a12] text-white overflow-hidden">
      {/* Ambient background effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-violet-500/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-cyan-500/10 rounded-full blur-[120px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-amber-500/5 rounded-full blur-[150px]" />
        <div className="absolute top-1/3 right-1/3 w-[400px] h-[400px] bg-emerald-500/8 rounded-full blur-[100px]" />
      </div>

      {/* Navigation */}
      <nav className="relative z-10 border-b border-white/10 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 via-cyan-500 to-amber-500 flex items-center justify-center shadow-lg shadow-violet-500/25">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-violet-400 via-cyan-400 to-amber-400 bg-clip-text text-transparent">
              TRADSLY
            </span>
          </div>
          <div className="flex items-center gap-6">
            <a href="#features" className="text-sm text-zinc-400 hover:text-white transition-colors">
              Features
            </a>
            <a href="#pairs" className="text-sm text-zinc-400 hover:text-white transition-colors">
              Markets
            </a>
            <a href="#how-it-works" className="text-sm text-zinc-400 hover:text-white transition-colors">
              How It Works
            </a>
            <Link
              to="/auth"
              className="px-5 py-2.5 text-sm font-semibold bg-gradient-to-r from-violet-500 to-cyan-500 hover:from-violet-600 hover:to-cyan-600 rounded-xl transition-all shadow-lg shadow-violet-500/25"
            >
              Get Started Free
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative z-10 pt-24 pb-32 px-6">
        <div className="max-w-6xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-violet-500/20 to-cyan-500/20 border border-violet-500/30 mb-8">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span className="text-sm text-white font-medium">AI-Powered Trading Intelligence</span>
            </div>
            
            <h1 className="text-6xl md:text-8xl font-extrabold tracking-tight mb-6">
              <span className="bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
                Trade With
              </span>
              <br />
              <span className="bg-gradient-to-r from-violet-400 via-cyan-400 to-amber-400 bg-clip-text text-transparent">
                Confidence
              </span>
            </h1>
            
            <p className="text-xl md:text-2xl text-zinc-300 max-w-3xl mx-auto mb-12 leading-relaxed">
              TRADSLY learns from millions of market patterns and delivers 
              intelligent trade recommendations. Start with paper trading, 
              validate your edge, and deploy with confidence.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                to="/auth"
                className="group px-10 py-4 bg-gradient-to-r from-violet-500 via-cyan-500 to-amber-500 text-white font-bold rounded-2xl hover:from-violet-600 hover:via-cyan-600 hover:to-amber-600 transition-all shadow-2xl shadow-violet-500/30 flex items-center gap-3 text-lg"
              >
                Start Trading Now
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <a
                href="#how-it-works"
                className="px-10 py-4 bg-white/10 border-2 border-white/20 font-semibold rounded-2xl hover:bg-white/15 transition-all text-zinc-200 text-lg"
              >
                See How It Works
              </a>
            </div>
          </motion.div>

          {/* Live Currency Pairs Preview */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="mt-20"
          >
            <p className="text-sm text-zinc-500 mb-4 uppercase tracking-wider font-medium">Live Market Data</p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {currencyPairs.map((pair) => (
                <div
                  key={pair.symbol}
                  className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.08] hover:border-white/[0.15] transition-all hover:bg-white/[0.05]"
                >
                  <div className="text-sm font-bold text-white mb-1">{pair.symbol}</div>
                  <div className="text-xs text-zinc-500 mb-2">{pair.name}</div>
                  <div className={`text-lg font-bold ${pair.positive ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {pair.change}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="relative z-10 py-32 px-6 border-t border-white/10">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-center mb-20"
          >
            <h2 className="text-4xl md:text-5xl font-extrabold mb-6">
              Everything You Need to{' '}
              <span className="bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
                Succeed
              </span>
            </h2>
            <p className="text-xl text-zinc-400 max-w-2xl mx-auto">
              From market analysis to pattern recognition to risk management—TRADSLY handles it all.
            </p>
          </motion.div>

          <motion.div
            variants={container}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="grid md:grid-cols-2 lg:grid-cols-3 gap-8"
          >
            {features.map((feature) => (
              <motion.div
                key={feature.title}
                variants={item}
                className="group relative p-8 rounded-3xl bg-white/[0.03] border border-white/[0.08] hover:border-white/[0.15] transition-all hover:bg-white/[0.05]"
              >
                <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${feature.gradient} p-[2px] mb-6 shadow-lg`}>
                  <div className="w-full h-full rounded-[15px] bg-[#0a0a12] flex items-center justify-center">
                    <feature.icon className="w-6 h-6 text-white" />
                  </div>
                </div>
                <h3 className="text-xl font-bold mb-3 text-white">{feature.title}</h3>
                <p className="text-zinc-400 leading-relaxed">{feature.description}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="relative z-10 py-32 px-6 border-t border-white/10">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-20"
          >
            <h2 className="text-4xl md:text-5xl font-extrabold mb-6">
              How <span className="bg-gradient-to-r from-cyan-400 to-amber-400 bg-clip-text text-transparent">TRADSLY</span> Works
            </h2>
            <p className="text-xl text-zinc-400 max-w-2xl mx-auto">
              A simple three-step process to smarter trading.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: "01",
                title: "Pick Your Pairs",
                description: "Browse our catalog of cryptocurrency pairs and select the markets you want to trade. Each pair comes with liquidity analysis and volatility metrics.",
                color: "from-violet-500 to-purple-600"
              },
              {
                step: "02",
                title: "Let AI Learn",
                description: "Our engine analyzes price action, volume, and technical indicators across multiple timeframes to identify high-probability setups.",
                color: "from-cyan-500 to-blue-600"
              },
              {
                step: "03",
                title: "Trade Smarter",
                description: "Receive intelligent trade recommendations with entry points, stop-losses, and take-profit targets. Start with paper trading to validate.",
                color: "from-amber-500 to-orange-600"
              }
            ].map((step, index) => (
              <motion.div
                key={step.step}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.15 }}
                className="relative p-8 rounded-3xl bg-white/[0.03] border border-white/[0.08]"
              >
                <div className={`text-6xl font-extrabold bg-gradient-to-r ${step.color} bg-clip-text text-transparent mb-6`}>
                  {step.step}
                </div>
                <h3 className="text-2xl font-bold mb-4 text-white">{step.title}</h3>
                <p className="text-zinc-400 leading-relaxed text-lg">{step.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section id="pairs" className="relative z-10 py-32 px-6 border-t border-white/10">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-20"
          >
            <h2 className="text-4xl md:text-5xl font-extrabold mb-6">
              Built for{' '}
              <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                Precision
              </span>
            </h2>
          </motion.div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { value: "50+", label: "Currency Pairs", color: "text-violet-400" },
              { value: "15m", label: "Timeframe Analysis", color: "text-cyan-400" },
              { value: "0.5%", label: "Risk Per Trade", color: "text-amber-400" },
              { value: "2:1", label: "Reward to Risk", color: "text-emerald-400" }
            ].map((stat) => (
              <div key={stat.label} className="text-center p-6 rounded-3xl bg-white/[0.03] border border-white/[0.08]">
                <div className={`text-4xl md:text-5xl font-extrabold mb-2 ${stat.color}`}>{stat.value}</div>
                <div className="text-zinc-400 font-medium">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative z-10 py-32 px-6 border-t border-white/10">
        <div className="max-w-5xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <div className="relative p-12 md:p-16 rounded-[2rem] bg-gradient-to-br from-violet-500/20 via-cyan-500/10 to-amber-500/20 border border-white/10">
              <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-cyan-500/5 rounded-[2rem] blur-xl" />
              <div className="relative">
                <h2 className="text-4xl md:text-5xl font-extrabold mb-6 text-white">
                  Ready to Transform Your Trading?
                </h2>
                <p className="text-xl text-zinc-300 mb-10 max-w-2xl mx-auto">
                  Join thousands of traders using AI to make smarter decisions. 
                  Start with free paper trading—no credit card required.
                </p>
                <Link
                  to="/auth"
                  className="inline-flex items-center gap-3 px-12 py-5 bg-gradient-to-r from-violet-500 via-cyan-500 to-amber-500 text-white font-bold rounded-2xl hover:from-violet-600 hover:via-cyan-600 hover:to-amber-600 transition-all shadow-2xl shadow-violet-500/30 text-xl"
                >
                  Create Free Account
                  <ArrowRight className="w-6 h-6" />
                </Link>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/10 py-10 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 via-cyan-500 to-amber-500 flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="text-lg font-bold bg-gradient-to-r from-violet-400 via-cyan-400 to-amber-400 bg-clip-text text-transparent">
              TRADSLY
            </span>
          </div>
          <div className="text-sm text-zinc-500">
            © 2024 TRADSLY. For research and educational purposes only.
          </div>
        </div>
      </footer>
    </div>
  );
}
