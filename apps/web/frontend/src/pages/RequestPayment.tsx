import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, DollarSign, Bitcoin, ShieldCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { motion } from "framer-motion";
import { useWallet } from "@/hooks/useWallet";
import { usePayments } from "@/hooks/usePayments";
import { useContract } from "@/hooks/useContract";
import { useToast } from "@/hooks/use-toast";
import { RELAYER_URL } from "@/lib/contract";

// ---------------------------------------------------------------------------
// Per-merchant BTC address index — tracked in localStorage so each payment
// gets a fresh stealth address derived by the relayer.
// ---------------------------------------------------------------------------
const getNextIndex = (address: string): number =>
  parseInt(localStorage.getItem(`bitbridge_idx_${address}`) ?? "0", 10);

const incrementIndex = (address: string): void => {
  const curr = getNextIndex(address);
  localStorage.setItem(`bitbridge_idx_${address}`, String(curr + 1));
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const RequestPayment = () => {
  const navigate = useNavigate();
  const { address, isConnected } = useWallet();
  const { addPayment } = usePayments();
  const { provider, writeContract } = useContract();
  const { toast } = useToast();

  const [amount, setAmount] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [step, setStep] = useState("");
  const [prices, setPrices] = useState<{ btcUsd: number; strkUsd: number } | null>(null);

  const numAmount = parseFloat(amount) || 0;

  // Fetch prices on mount so we can show a live BTC estimate as the user types.
  useEffect(() => {
    fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,starknet&vs_currencies=usd"
    )
      .then((r) => r.json())
      .then((data) =>
        setPrices({ btcUsd: data.bitcoin.usd, strkUsd: data.starknet.usd })
      )
      .catch(() => {}); // silent — we re-fetch fresh on submit anyway
  }, []);

  const estimatedBtc =
    prices && numAmount > 0 ? (numAmount / prices.btcUsd).toFixed(8) : null;

  // ---------------------------------------------------------------------------
  // Create payment flow
  // ---------------------------------------------------------------------------
  const handleCreate = async () => {
    if (numAmount <= 0) return;

    if (!isConnected || !address) {
      toast({ title: "Connect your wallet first", variant: "destructive" });
      return;
    }
    if (!writeContract) {
      toast({ title: "Wallet not ready", variant: "destructive" });
      return;
    }

    setIsCreating(true);
    try {
      // 1 — Fetch current prices (fresh fetch to avoid stale estimates)
      setStep("Fetching prices…");
      const priceRes = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,starknet&vs_currencies=usd"
      );
      if (!priceRes.ok) throw new Error("Could not fetch BTC/STRK prices");
      const priceData = await priceRes.json();
      const btcUsd: number = priceData.bitcoin.usd;
      const strkUsd: number = priceData.starknet.usd;

      // 2 — Compute on-chain amounts using integer arithmetic to avoid float issues
      // required_btc_sats       = (usdAmount / btcPrice)  * 10^8
      // amount_settlement_units = (usdAmount / strkPrice) * 10^18
      const usdCents = BigInt(Math.round(numAmount * 100));
      const btcPriceCents = BigInt(Math.round(btcUsd * 100));
      const strkPriceCents = BigInt(Math.round(strkUsd * 100));

      const requiredSats = (usdCents * 100_000_000n) / btcPriceCents;
      const amountSettlementUnits = (usdCents * 10n ** 18n) / strkPriceCents;
      const amountBtc = Number(requiredSats) / 100_000_000;

      // 3 — Get a fresh stealth BTC address from the relayer
      setStep("Generating BTC address…");
      const index = getNextIndex(address);
      const relayerRes = await fetch(
        `${RELAYER_URL}/api/stealth-address?merchant=${address}&index=${index}`
      );
      if (!relayerRes.ok)
        throw new Error("Relayer unavailable — make sure it is running on port 3001");
      const { address: btcAddress } = await relayerRes.json();

      // 4 — Generate a unique payment_id that fits felt252 (< 2^251)
      const randomBytes = crypto.getRandomValues(new Uint8Array(16));
      const randomHex = Array.from(randomBytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const paymentId =
        "0x" + (BigInt("0x" + randomHex) % 2n ** 251n).toString(16);

      // 5 — Call create_payment on-chain
      setStep("Submitting to Starknet…");
      const result = await writeContract.create_payment(
        address,                              // merchant: ContractAddress
        "0x" + amountSettlementUnits.toString(16), // amount_settlement_units: u128
        paymentId,                            // payment_id: felt252
        btcAddress,                           // btc_address: ByteArray
        "0x" + requiredSats.toString(16),     // required_btc_sats: u64
        isPrivate ? 1 : 0                     // is_private: bool
      );

      // 6 — Wait for the transaction to be accepted on-chain
      setStep("Waiting for confirmation…");
      await provider.waitForTransaction(result.transaction_hash);

      // 7 — Persist locally and navigate to the payment detail page
      incrementIndex(address);
      addPayment({
        id: paymentId,
        paymentId,
        amountUsd: numAmount,
        amountBtc,
        btcAddress,
        status: "pending",
        settlementAsset: "STRK",
        settlementChain: "Starknet Sepolia",
        createdAt: new Date(),
        txHash: result.transaction_hash,
      });

      navigate(`/payment/${paymentId}`);
    } catch (err) {
      toast({
        title: "Failed to create payment",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
      setStep("");
    }
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
              Your customer pays in Bitcoin. You receive STRK on Starknet Sepolia.
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
              {estimatedBtc && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Bitcoin className="h-3.5 w-3.5 text-orange-400" />
                  ≈ {estimatedBtc} BTC at current price
                </p>
              )}
            </div>

            {/* Privacy toggle */}
            <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Private payment</p>
                  <p className="text-xs text-muted-foreground">Hide settlement amount in on-chain events</p>
                </div>
              </div>
              <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
            </div>

            {!isConnected && (
              <p className="text-sm text-destructive">
                Connect your wallet before creating a payment request.
              </p>
            )}

            {isCreating && step && (
              <p className="animate-pulse text-sm text-muted-foreground">{step}</p>
            )}

            <Button
              variant="hero"
              size="lg"
              className="w-full"
              disabled={numAmount <= 0 || isCreating || !isConnected}
              onClick={handleCreate}
            >
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {step || "Creating on-chain…"}
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
