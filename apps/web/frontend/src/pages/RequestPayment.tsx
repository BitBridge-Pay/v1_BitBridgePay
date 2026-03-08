import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, DollarSign } from "lucide-react";
import type { SettlementAsset } from "@/lib/mockData";
import { motion } from "framer-motion";

const RequestPayment = () => {
  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState<SettlementAsset>("STRK");
  const [isCreating, setIsCreating] = useState(false);

  const numAmount = parseFloat(amount) || 0;

  const handleCreate = async () => {
    if (numAmount <= 0) return;
    setIsCreating(true);
    // TODO: Call contract to create payment request
    // Expected: returns paymentId + btcAddress derived from stealth address logic
    // Then: addPayment(...) and navigate to /payment/:id
    setIsCreating(false);
  };

  return (
    <div className="container flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <Card className="gradient-card border-border">
          <CardHeader>
            <CardTitle className="font-display text-2xl">Request Payment</CardTitle>
            <CardDescription>
              Create a BTC payment request. Your customer pays in Bitcoin, you receive {asset} on Starknet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="amount">Amount (USD)</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="pl-9 text-lg font-display"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Settlement Asset</Label>
              <Select value={asset} onValueChange={(v) => setAsset(v as SettlementAsset)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="STRK">STRK (Starknet)</SelectItem>
                  <SelectItem value="USDC">USDC (Starknet)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              variant="hero"
              size="lg"
              className="w-full"
              disabled={numAmount <= 0 || isCreating}
              onClick={handleCreate}
            >
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating on-chain...
                </>
              ) : (
                "Create Payment Request"
              )}
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
};

export default RequestPayment;
