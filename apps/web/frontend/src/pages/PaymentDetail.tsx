import { useParams, Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Copy, ExternalLink, Share2, ArrowLeft, Check } from "lucide-react";
import { usePayments } from "@/hooks/usePayments";
import { useContract, decodePayment } from "@/hooks/useContract";
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

const PaymentDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { getPayment, updatePayment } = usePayments();
  const payment = getPayment(id || "");
  const { readContract } = useContract();
  const { toast } = useToast();
  const [copied, setCopied] = useState<string | null>(null);

  // Poll the contract for live status.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const raw = await readContract.get_payment(id);
        const decoded = decodePayment(raw);
        if (!decoded.initialized || cancelled) return;
        const newStatus = chainStatus(decoded);
        updatePayment(id, {
          status: newStatus,
          ...(decoded.settled && !payment?.txHash
            ? { settledAt: new Date() }
            : {}),
        });
      } catch {
        // ignore between polls
      }
    };

    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, readContract]);

  if (!payment) {
    return (
      <div className="container flex min-h-[calc(100vh-4rem)] items-center justify-center">
        <Card className="max-w-md text-center">
          <CardContent className="p-8">
            <p className="text-muted-foreground">Payment not found.</p>
            <Link to="/">
              <Button variant="outline" className="mt-4">Go Home</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const btcUri = `bitcoin:${payment.btcAddress}?amount=${payment.amountBtc}`;
  const shareUrl = `${window.location.origin}/pay/${payment.paymentId}`;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    toast({ title: "Copied!", description: `${label} copied to clipboard.` });
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="container max-w-2xl px-4 py-12">
      <Link to="/history" className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to history
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Card className="gradient-card border-border">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="font-display text-2xl">${payment.amountUsd.toFixed(2)}</CardTitle>
              <p className="text-sm text-muted-foreground">Payment Request</p>
            </div>
            <StatusBadge status={payment.status} />
          </CardHeader>

          <CardContent className="space-y-6">
            {/* QR Code */}
            <div className="flex flex-col items-center rounded-xl border border-border bg-foreground/[0.02] p-8">
              <div className="rounded-2xl bg-foreground p-4">
                <QRCodeSVG
                  value={btcUri}
                  size={220}
                  bgColor="hsl(40, 20%, 95%)"
                  fgColor="hsl(220, 20%, 4%)"
                  level="M"
                />
              </div>
              <p className="mt-4 text-sm text-muted-foreground">Scan to pay with Bitcoin</p>
            </div>

            {/* Details */}
            <div className="space-y-3">
              <DetailRow
                label="BTC Amount"
                value={`${payment.amountBtc} BTC`}
                onCopy={() => copyToClipboard(payment.amountBtc.toString(), "BTC Amount")}
                copied={copied === "BTC Amount"}
                highlight
              />
              <DetailRow
                label="BTC Address"
                value={payment.btcAddress}
                onCopy={() => copyToClipboard(payment.btcAddress, "BTC Address")}
                copied={copied === "BTC Address"}
                mono
              />
              <DetailRow
                label="Payment ID"
                value={payment.paymentId}
                onCopy={() => copyToClipboard(payment.paymentId, "Payment ID")}
                copied={copied === "Payment ID"}
              />
              <DetailRow label="Settlement" value={`${payment.settlementAsset} on ${payment.settlementChain}`} />
              <DetailRow label="Created" value={payment.createdAt.toLocaleString()} />
            </div>

            {/* Settlement info */}
            {payment.status === "settled" && payment.txHash && (
              <div className="rounded-lg border border-success/20 bg-success/5 p-4 text-center">
                <p className="text-sm font-medium text-success">
                  Payment settled! {payment.settlementAsset} credited to your wallet.
                </p>
                <a
                  href={`https://sepolia.starkscan.co/tx/${payment.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                >
                  View on Explorer <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 gap-2"
                onClick={() => copyToClipboard(shareUrl, "Share Link")}
              >
                <Share2 className="h-4 w-4" />
                {copied === "Share Link" ? "Copied!" : "Share Link"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
};

const DetailRow = ({
  label,
  value,
  onCopy,
  copied,
  mono,
  highlight,
}: {
  label: string;
  value: string;
  onCopy?: () => void;
  copied?: boolean;
  mono?: boolean;
  highlight?: boolean;
}) => (
  <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3">
    <span className="text-sm text-muted-foreground">{label}</span>
    <div className="flex items-center gap-2">
      <span
        className={`text-sm ${mono ? "font-mono text-xs" : ""} ${highlight ? "font-display font-semibold text-primary" : ""} max-w-[120px] truncate sm:max-w-[220px]`}
      >
        {value}
      </span>
      {onCopy && (
        <button onClick={onCopy} className="text-muted-foreground hover:text-foreground">
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      )}
    </div>
  </div>
);

export default PaymentDetail;
