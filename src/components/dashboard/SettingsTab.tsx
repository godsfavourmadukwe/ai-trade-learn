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
  Clock,
  Server
} from "lucide-react";

interface ApiConfig {
  binanceApiKey: string;
  binanceApiSecret: string;
  bybitApiKey: string;
  bybitApiSecret: string;
  openaiApiKey: string;
}

interface SettingsTabProps {
  onSave: (config: ApiConfig) => void;
  currentDataSource?: string;
  refreshInterval?: number;
  apiStatus?: Record<string, "connected" | "error" | "loading">;
}

export function SettingsTab({ onSave, currentDataSource, refreshInterval = 1, apiStatus = {} }: SettingsTabProps) {
  const [config, setConfig] = useState<ApiConfig>({
    binanceApiKey: "",
    binanceApiSecret: "",
    bybitApiKey: "",
    bybitApiSecret: "",
    openaiApiKey: "",
  });
  
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);

  const services = [
    {
      name: "Bybit",
      key: "bybit",
      description: "Primary exchange API - Real-time spot data",
      isPrimary: true,
      url: "https://www.bybit.com",
    },
    {
      name: "Binance",
      key: "binance",
      description: "Largest exchange - Deep liquidity",
      isPrimary: true,
      url: "https://www.binance.com",
    },
    {
      name: "CoinGecko",
      key: "coingecko",
      description: "Market data aggregator - Market cap info",
      isPrimary: false,
      url: "https://www.coingecko.com",
    },
    {
      name: "CryptoCompare",
      key: "cryptocompare",
      description: "Historical data & real-time pricing",
      isPrimary: false,
      url: "https://www.cryptocompare.com",
    },
    {
      name: "Kraken",
      key: "kraken",
      description: "European exchange - High security",
      isPrimary: false,
      url: "https://www.kraken.com",
    },
    {
      name: "CoinMarketCap",
      key: "coinmarketcap",
      description: "Market cap rankings & data",
      isPrimary: false,
      url: "https://coinmarketcap.com",
    },
  ];

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
  };

  const getStatusForService = (key: string): "connected" | "error" | "loading" => {
    return apiStatus[key] || "loading";
  };

  const connectedCount = Object.values(apiStatus).filter(s => s === "connected").length;

  return (
    <div className="space-y-6">
      {/* Live Data Status */}
      <Card className="bg-[#111118] border-white/[0.08]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            Multi-API Market Feed
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-gradient-to-r from-violet-500/10 to-cyan-500/10 border border-violet-500/20">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center">
                  <Server className="w-5 h-5 text-violet-400" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">
                    {connectedCount} / 6 APIs Active
                  </h4>
                  <p className="text-xs text-zinc-400">Aggregated for accuracy</p>
                </div>
              </div>
            </div>
            
            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">1-Second Updates</h4>
                  <p className="text-xs text-zinc-400">Real-time price feed</p>
                </div>
              </div>
            </div>
            
            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                  <Zap className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">Median Price</h4>
                  <p className="text-xs text-zinc-400">Cross-exchange validation</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* API Status Grid */}
      <Card className="bg-[#111118] border-white/[0.08]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
            <Server className="w-4 h-4 text-violet-400" />
            Connected Exchanges & APIs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {services.map(service => {
              const status = getStatusForService(service.key);
              return (
                <div
                  key={service.key}
                  className={`p-4 rounded-xl border transition-all ${
                    service.isPrimary 
                      ? "bg-violet-500/5 border-violet-500/20" 
                      : "bg-white/[0.03] border-white/[0.08]"
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-white">{service.name}</h4>
                        {service.isPrimary && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 font-medium">
                            PRIMARY
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 mt-1">{service.description}</p>
                    </div>
                    <StatusBadge
                      status={status === "connected" ? "success" : status === "error" ? "error" : "warning"}
                      label={status === "connected" ? "Live" : status === "error" ? "Error" : "Checking"}
                    />
                  </div>
                  <a
                    href={service.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-violet-400"
                  >
                    Visit {service.name}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* How Aggregation Works */}
      <Card className="bg-[#111118] border-white/[0.08]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            Price Aggregation Method
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
            <p className="text-sm text-zinc-400 mb-4">
              TRADSLY aggregates prices from all 6 APIs simultaneously and uses the <span className="text-white font-bold">median price</span> for maximum accuracy. This cross-validation prevents manipulation and ensures you get the true market price.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Data Sources", value: "6 APIs" },
                { label: "Update Speed", value: "1 second" },
                { label: "Validation", value: "Median" },
                { label: "Fallback", value: "Auto" },
              ].map(item => (
                <div key={item.label} className="text-center p-3 rounded-lg bg-white/[0.02]">
                  <div className="text-xs text-zinc-500">{item.label}</div>
                  <div className="text-sm font-bold text-white mt-1">{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* API Keys (Optional - for trading) */}
      <Card className="bg-[#111118] border-white/[0.08]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-zinc-300 flex items-center gap-2">
            <Key className="w-4 h-4 text-amber-400" />
            Trading API Keys (Optional)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-xs text-zinc-500">
            Market data is free and requires no keys. API keys are only needed if you want to execute trades directly through TRADSLY.
          </p>

          {/* Bybit Trading */}
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
            <div className="flex items-center gap-3 mb-4">
              <Database className="w-5 h-5 text-cyan-400" />
              <div>
                <h4 className="text-sm font-bold text-white">Bybit Trading</h4>
                <p className="text-xs text-zinc-400">Execute trades on Bybit</p>
              </div>
            </div>
            
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-zinc-400">API Key</Label>
                <div className="relative mt-1">
                  <Input
                    type={showSecrets.bybitApiKey ? "text" : "password"}
                    value={config.bybitApiKey}
                    onChange={(e) => handleChange("bybitApiKey", e.target.value)}
                    placeholder="Enter Bybit API key"
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
                    placeholder="Enter Bybit API secret"
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
                href="https://www.bybit.com/app/user/api-management"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300"
              >
                Get Bybit API keys
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          {/* Binance Trading */}
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
            <div className="flex items-center gap-3 mb-4">
              <Database className="w-5 h-5 text-amber-400" />
              <div>
                <h4 className="text-sm font-bold text-white">Binance Trading</h4>
                <p className="text-xs text-zinc-400">Execute trades on Binance</p>
              </div>
            </div>
            
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-zinc-400">API Key</Label>
                <div className="relative mt-1">
                  <Input
                    type={showSecrets.binanceApiKey ? "text" : "password"}
                    value={config.binanceApiKey}
                    onChange={(e) => handleChange("binanceApiKey", e.target.value)}
                    placeholder="Enter Binance API key"
                    className="bg-white/[0.03] border-white/[0.08] pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => toggleShowSecret("binanceApiKey")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                  >
                    {showSecrets.binanceApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              
              <div>
                <Label className="text-xs text-zinc-400">API Secret</Label>
                <div className="relative mt-1">
                  <Input
                    type={showSecrets.binanceApiSecret ? "text" : "password"}
                    value={config.binanceApiSecret}
                    onChange={(e) => handleChange("binanceApiSecret", e.target.value)}
                    placeholder="Enter Binance API secret"
                    className="bg-white/[0.03] border-white/[0.08] pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => toggleShowSecret("binanceApiSecret")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                  >
                    {showSecrets.binanceApiSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              
              <a
                href="https://www.binance.com/en/my/settings/api-management"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300"
              >
                Get Binance API keys
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          {/* OpenAI */}
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
            <div className="flex items-center gap-3 mb-4">
              <Shield className="w-5 h-5 text-violet-400" />
              <div>
                <h4 className="text-sm font-bold text-white">OpenAI (Optional)</h4>
                <p className="text-xs text-zinc-400">Enhanced AI pattern analysis</p>
              </div>
            </div>
            
            <div>
              <Label className="text-xs text-zinc-400">API Key</Label>
              <div className="relative mt-1">
                <Input
                  type={showSecrets.openaiApiKey ? "text" : "password"}
                  value={config.openaiApiKey}
                  onChange={(e) => handleChange("openaiApiKey", e.target.value)}
                  placeholder="Enter OpenAI API key"
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

      {/* Security */}
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
              <p>Market data from all 6 APIs is free and requires no authentication.</p>
            </div>
            <div className="flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <p>Trading API keys are only needed when you want to execute live trades.</p>
            </div>
            <div className="flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <p>API keys are stored locally in your browser and never sent to our servers.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
