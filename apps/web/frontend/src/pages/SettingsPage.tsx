import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { LogOut, Copy, Check } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { useState } from "react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";

const SettingsPage = () => {
  const { address, disconnect, network, setNetwork } = useWallet();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const copyAddress = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    toast({ title: "Copied!", description: "Wallet address copied." });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="container max-w-lg px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="space-y-6"
      >
        <h1 className="font-display text-3xl font-bold">Settings</h1>

        <Card className="gradient-card border-border">
          <CardHeader>
            <CardTitle className="text-lg">Wallet</CardTitle>
            <CardDescription>Connected Starknet wallet</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3">
              <span className="truncate font-mono text-sm">{address}</span>
              <button onClick={copyAddress} className="text-muted-foreground hover:text-foreground">
                {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <Button variant="destructive" className="w-full gap-2" onClick={disconnect}>
              <LogOut className="h-4 w-4" /> Disconnect Wallet
            </Button>
          </CardContent>
        </Card>

        <Card className="gradient-card border-border">
          <CardHeader>
            <CardTitle className="text-lg">Network</CardTitle>
            <CardDescription>Select Starknet network</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Active Network</Label>
              <Select value={network} onValueChange={(v) => setNetwork(v as "sepolia" | "mainnet")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sepolia">Sepolia (Testnet)</SelectItem>
                  <SelectItem value="mainnet">Mainnet</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Badge variant={network === "sepolia" ? "testnet" : "default"}>
              {network === "sepolia" ? "Testnet Mode" : "Mainnet"}
            </Badge>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
};

export default SettingsPage;
