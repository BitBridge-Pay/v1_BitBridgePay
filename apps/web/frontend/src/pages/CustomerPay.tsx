import { useParams, Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Copy, ExternalLink, Check, Zap, Loader2 } from "lucide-react";
import { useContract, decodePayment, btcFromSats } from "@/hooks/useContract";
import StatusBadge from "@/components/StatusBadge";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import type { PaymentStatus } from "@/lib/mockData";

const POLL_MS = 10_000;

function chainStatus(raw: ReturnType<typeof decodePayment>): PaymentStatus {
  if (raw.settled) return "settled";
  if (raw.cancelled) return "expired";
  if (raw.btc_block_height > 0n) return "confirming";
  return "pending";
}

interface ChainPayment {
  btcAddress: string;
  amountBtc: string;
  status: PaymentStatus;
}

const CustomerPay = () => {
  const { paymentId } = useParams<{ paymentId: string }>();
  const { readContract } = useContract();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [payment, setPayment] = useState<ChainPayment | null>(null);

  useEffect(() => {
    if (!paymentId) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const raw = await readContract.get_payment(paymentId);
        const decoded = decodePayment(raw);
        if (cancelled) return;
        if (!decoded.initialized) {
          setPayment(null);
        } else {
          setPayment({
            btcAddress: decoded.btc_address,
            amountBtc: btcFromSats(decoded.required_btc_sats),
            status: chainStatus(decoded),
          });
        }
      } catch {
        // keep retrying on network errors
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [paymentId, readContract]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!payment) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="max-w-md text-center">
          <CardContent className="p-8">
            <Zap className="mx-auto mb-4 h-8 w-8 text-primary" />
            <p className="font-display text-lg font-semibold">Payment not found</p>
            <p className="mt-2 text-sm text-muted-foreground">
              This payment link may be invalid or expired.
            </p>
            <Link to="/">
              <Button variant="outline" className="mt-4">Go to BitBridgePay</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const btcUri = `bitcoin:${payment.btcAddress}?amount=${payment.amountBtc}`;
  const statusStep =
    payment.status === "pending" ? 0 : payment.status === "confirming" ? 1 : 2;
  const steps = ["Waiting for payment", "Confirming on Bitcoin", "Complete"];

  const copyAddress = () => {
    navigator.clipboard.writeText(payment.btcAddress);
    setCopied(true);
    toast({ title: "Copied!", description: "BTC address copied." });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-sm"
      >
        {/* Logo */}
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-hero">
            <Zap className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-display text-lg font-bold">
            BitBridge<span className="text-primary">Pay</span>
          </span>
        </div>

        <Card className="gradient-card border-border">
          <CardContent className="space-y-6 p-6">
            {/* Amount */}
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Send exactly</p>
              <p className="font-display text-4xl font-bold text-primary">{payment.amountBtc} BTC</p>
            </div>

            {/* QR Code */}
            <div className="flex justify-center">
              <div className="rounded-2xl bg-foreground p-3">
                <QRCodeSVG
                  value={btcUri}
                  size={180}
                  bgColor="hsl(40, 20%, 95%)"
                  fgColor="hsl(220, 20%, 4%)"
                  level="M"
                />
              </div>
            </div>

            {/* Address */}
            <div className="space-y-2">
              <p className="text-center text-xs text-muted-foreground">BTC Address</p>
              <div
                className="flex cursor-pointer items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2.5"
                onClick={copyAddress}
              >
                <span className="truncate font-mono text-xs">{payment.btcAddress}</span>
                {copied ? (
                  <Check className="h-4 w-4 shrink-0 text-success" />
                ) : (
                  <Copy className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
              </div>
            </div>

            {/* Open in wallet */}
            <a href={btcUri}>
              <Button variant="hero" size="lg" className="w-full gap-2">
                Open in Wallet
                <ExternalLink className="h-4 w-4" />
              </Button>
            </a>

            {/* Status tracker */}
            <div className="space-y-3 rounded-lg border border-border p-4">
              <p className="text-xs font-medium text-muted-foreground">Status</p>
              {steps.map((step, i) => (
                <div key={step} className="flex items-center gap-3">
                  <div
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      i <= statusStep
                        ? "bg-primary text-primary-foreground"
                        : "border border-border text-muted-foreground"
                    }`}
                  >
                    {i < statusStep ? "✓" : i + 1}
                  </div>
                  <span
                    className={`text-sm ${
                      i <= statusStep ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {step}
                  </span>
                  {i === statusStep && i < 2 && (
                    <span className="ml-auto h-2 w-2 animate-pulse rounded-full bg-primary" />
                  )}
                </div>
              ))}
            </div>

            <StatusBadge status={payment.status} />
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
};

export default CustomerPay;
