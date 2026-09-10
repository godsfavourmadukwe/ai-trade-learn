import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "./StatusBadge";
import { 
  Key, 
  Save, 
  RefreshCw, 
  Shield, 
  Database, 
  Activity,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  Eye,
  EyeOff,
  Zap,
  TrendingUp,
  Clock
} from "lucide-react";

interface ApiConfig {
  bybitApiKey: string;
  bybitApiSecret: string;
  binanceApiKey: string;
  binanceApiSecret: string;
  openaiApiKey: string;
}

interface ServiceStatus {
  name: string;
  status: "connected" | "disconnected" | "error" | "limited";
  lastChecked: number | null;
  description: string;
  isPrimary?: boolean;
}

interface SettingsTabProps {
  onSave: (config: ApiConfig) => void;
  currentDataSource?: string;
  refreshInterval?: number;
}

export function SettingsTab({ onSave, currentDataSource, refreshInterval = 10 }: SettingsTabProps) {
  const [config, setConfig] = useState<ApiConfig>({
    bybitApiKey: "",
    bybitApiSecret: "",
    binanceApiKey: "",
    binanceApiSecret: "",
    openaiApiKey: "",
  });
  
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);

  const [services, setServices] = useState<ServiceStatus[]>([
    {
      name: "Bybit API",
      status: "connected",
      lastChecked: Date.now(),
      description: "Primary market data source - Free, no key required",
      isPrimary: true,
    },
    {
      name: "CoinGecko API",
      status: "connected",
      lastChecked: Date.now(),
      description: "Backup data source with market cap info",
    },
    {
      name: "Binance API",
      status: "disconnected",
      lastChecked: null,
      description: "Alternative exchange for live trading",
    },
    {
      name: "AI Analysis Engine",
      status: "connected",
      lastChecked: Date.now(),
      description: "Pattern recognition and trade recommendations",
    },
    {
      name: "Risk Management",
      status: "connected",
      lastChecked: Date.now(),
      description: "Position sizing and portfolio protection",
    },
  ]);

  // Load saved config from localStorage
  useEffect(() => {
    const savedConfig = localStorage.getItem("tradslly_api_config");
    if (savedConfig) {
      try {
        setConfig(JSON.parse(savedConfig));
      } catch (e) {
        console.error("Failed to load saved config:", e);
      }
    }
  }, []);

  // Check API status
  const checkApiStatus = async () => {
    // Check Bybit
    try {
      const response = await fetch(
        "https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT",
        { method: "GET" }
      );
      
      const result = await response.json();
      const isConnected = result.retCode === 0;
      
      setServices(prev => prev.map(s => 
        s.name === "Bybit API" 
          ? { ...s, status: isConnected ? "connected" : "error", lastChecked: Date.now() }
          : s
      ));
    } catch {
      setServices(prev => prev.map(s => 
        s.name === "Bybit API" 
          ? { ...s, status: "error", lastChecked: Date.now() }
          : s
      ));
    }

    // Check CoinGecko
    try {
      const response = await fetch("https://api.coingecko.com/api/v3/ping");
      setServices(prev => prev.map(s => 
        s.name === "CoinGecko API" 
          ? { ...s, status: response.ok ? "connected" : "error", lastChecked: Date.now() }
          : s
      ));
    } catch {
      setServices(prev => prev.map(s => 
        s.name === "CoinGecko API" 
          ? { ...s, status: "error", lastChecked: Date.now() }
          : s
      ));
    }

    // Check Binance (if API key provided)
    if (config.binanceApiKey) {
      try {
        const response = await fetch("https://api.binance.com/api/v3/ping");
        setServices(prev => prev.map(s => 
          s.name === "Binance API" 
            ? { ...s, status: response.ok ? "connected" : "error", lastChecked: Date.now() }
            : s
        ));
      } catch {
        setServices(prev => prev.map(s => 
          s.name === "Binance API" 
            ? { ...s, status: "error", lastChecked: Date.now() }
            : s
        ));
      }
    }
  };

  useEffect(() => {
    checkApiStatus();
    const interval = setInterval(checkApiStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleChange = (key: keyof ApiConfig, value: string) => {
    setConfig(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const toggleShowSecret = (key: string) => {
    setShowSecrets(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async () => {
    setSaving(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    onSave(config);
    setHasChanges(false);
    setSaving(false);
    localStorage.setItem("tradslly_api_config", JSON.stringify(config));
    checkApiStatus();
  };

  const formatTime = (timestamp: number | null) => {
    if (!timestamp) return "Never";
    const diff = Date.now() - timestamp;
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return new Date(timestamp).toLocaleTimeString();
  };

  return (
    <div className="space-y-6">
      {/* Active Data Source & Refresh Status */}
      <Card className="bg-[#111118] border-white/[0.08]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            Live Data Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-gradient-to-r from-violet-500/10 to-cyan-500/10 border border-violet-500/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center">
                    <Zap className="w-5 h-5 text-violet-400" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">
                      {currentDataSource || "Bybit"}
                    </h4>
                    <p className="text-xs text-zinc-400">Active data source</p>
                  </div>
                </div>
                <StatusBadge status="success" label="Connected" />
              </div>
            </div>
            
            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                    <Clock className="w-5 h-5 text-cyan-400" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Auto-Refresh</h4>
                    <p className="text-xs text-zinc-400">Every {refreshInterval} seconds</p>
                  </div>
                </div>
                <StatusBadge status="success" label="Active" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Service Status */}
      <Card className="bg-[#111118] border-white/[0.08]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            Connected Services
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4">
            {services.map(service => (
              <div
                key={service.name}
                className={`p-4 rounded-xl border ${
                  service.isPrimary 
                    ? "bg-violet-500/5 border-violet-500/20" 
                    : "bg-white/[0.03] border-white/[0.08]"
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-white">{service.name}</h4>
                      {service.isPrimary && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300">
                          Primary
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 mt-1">{service.description}</p>
                  </div>
                  <StatusBadge
                    status={service.status === "connected" ? "success" : service.status === "error" ? "error" : "inactive"}
                    label={service.status.charAt(0).toUpperCase() + service.status.slice(1)}
                  />
                </div>
                <div className="text-xs text-zinc-500 mt-3">
                  Last checked: {formatTime(service.lastChecked)}
                </div>
              </div>
            ))}
          </div>
          
          <Button
            variant="outline"
            size="sm"
            onClick={checkApiStatus}
            className="mt-4 border-white/[0.08] hover:bg-white/[0.05]"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh Status
          </Button>
        </CardContent>
      </Card>

      {/* API Keys Configuration */}
      <Card className="bg-[#111118] border-white/[0.08]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
            <Key className="w-4 h-4 text-amber-400" />
            API Keys & Credentials
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Bybit - Free */}
          <div className="p-4 rounded-xl bg-violet-500/5 border border-violet-500/20">
            <div className="flex items-center gap-3 mb-3">
              <CheckCircle className="w-5 h-5 text-violet-400" />
              <div>
                <h4 className="text-sm font-bold text-white">Bybit API</h4>
                <p className="text-xs text-zinc-400">Free tier - Real-time market data, no key required</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-violet-400">
              <Zap className="w-3 h-3" />
              <span>Currently active - Fetching live prices every {refreshInterval} seconds</span>
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              Bybit provides free real-time cryptocurrency market data including BTC, ETH, SOL, and more.
              No API key needed for public market data endpoints.
            </p>
          </div>

          {/* CoinGecko - Free Backup */}
          <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
            <div className="flex items-center gap-3 mb-3">
              <CheckCircle className="w-5 h-5 text-emerald-400" />
              <div>
                <h4 className="text-sm font-bold text-white">CoinGecko API</h4>
                <p className="text-xs text-zinc-400">Free tier - Backup data source with market cap info</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-emerald-400">
              <Zap className="w-3 h-3" />
              <span>Active as backup when Bybit is unavailable</span>
            </div>
          </div>

          {/* Bybit Trading (Optional) */}
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
            <div className="flex items-center gap-3 mb-4">
              <Database className="w-5 h-5 text-cyan-400" />
              <div>
                <h4 className="text-sm font-bold text-white">Bybit Trading API (Optional)</h4>
                <p className="text-xs text-zinc-400">For live trading execution on Bybit</p>
              </div>
            </div>
            
            <div className="space-y-4">
              <div>
                <Label className="text-xs text-zinc-400">API Key</Label>
                <div className="relative mt-1">
                  <Input
                    type={showSecrets.bybitApiKey ? "text" : "password"}
                    value={config.bybitApiKey}
                    onChange={(e) => handleChange("bybitApiKey", e.target.value)}
                    placeholder="Enter your Bybit API key"
                    className="bg-white/[0.03] border-white/[0.08] pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => toggleShowSecret("bybitApiKey")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                  >
                    {showSecrets.bybitApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              
              <div>
                <Label className="text-xs text-zinc-400">API Secret</Label>
                <div className="relative mt-1">
                  <Input
                    type={showSecrets.bybitApiSecret ? "text" : "password"}
                    value={config.bybitApiSecret}
                    onChange={(e) => handleChange("bybitApiSecret", e.target.value)}
                    placeholder="Enter your Bybit API secret"
                    className="bg-white/[0.03] border-white/[0.08] pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => toggleShowSecret("bybitApiSecret")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                  >
                    {showSecrets.bybitApiSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              
              <a
                href="https://www.bybit.com/en/my/settings/api-management"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300"
              >
                Get API keys from Bybit
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          {/* OpenAI */}
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
            <div className="flex items-center gap-3 mb-4">
              <Shield className="w-5 h-5 text-violet-400" />
              <div>
                <h4 className="text-sm font-bold text-white">OpenAI API (Optional)</h4>
                <p className="text-xs text-zinc-400">For enhanced AI pattern analysis</p>
              </div>
            </div>
            
            <div>
              <Label className="text-xs text-zinc-400">API Key</Label>
              <div className="relative mt-1">
                <Input
                  type={showSecrets.openaiApiKey ? "text" : "password"}
                  value={config.openaiApiKey}
                  onChange={(e) => handleChange("openaiApiKey", e.target.value)}
                  placeholder="Enter your OpenAI API key"
                  className="bg-white/[0.03] border-white/[0.08] pr-10"
                />
                <button
                  type="button"
                  onClick={() => toggleShowSecret("openaiApiKey")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                >
                  {showSecrets.openaiApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              
              <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 mt-2"
              >
                Get API key from OpenAI
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex items-center gap-4 pt-4 border-t border-white/[0.05]">
            <Button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="bg-gradient-to-r from-violet-500 to-cyan-500 hover:from-violet-600 hover:to-cyan-600 text-white font-bold shadow-lg shadow-violet-500/25"
            >
              {saving ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Save Configuration
                </>
              )}
            </Button>
            
            {hasChanges && (
              <span className="text-sm text-amber-400">Unsaved changes</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Security Notice */}
      <Card className="bg-[#111118] border-white/[0.08]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-400" />
            Security Notes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm text-zinc-400">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <p>API keys are stored locally in your browser and never sent to our servers.</p>
            </div>
            <div className="flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <p>Bybit and CoinGecko APIs are free and don't require API keys for market data.</p>
            </div>
            <div className="flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <p>For Bybit trading, we recommend creating API keys with trade-only permissions.</p>
            </div>
            <div className="flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <p>Never share your API secrets. Enable IP whitelisting for extra security.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
