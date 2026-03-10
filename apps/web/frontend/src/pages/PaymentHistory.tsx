import { Link, useNavigate } from "react-router-dom"; // Link used for New Request button
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExternalLink, Plus } from "lucide-react";
import { usePayments } from "@/hooks/usePayments";
import StatusBadge from "@/components/StatusBadge";
import { useState } from "react";
import { motion } from "framer-motion";

const PaymentHistory = () => {
  const { payments } = usePayments();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<string>("all");

  const filtered = filter === "all" ? payments : payments.filter((p) => p.status === filter);

  return (
    <div className="container max-w-4xl px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold">Payment History</h1>
            <p className="text-sm text-muted-foreground">{payments.length} total requests</p>
          </div>
          <div className="flex gap-3">
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="confirming">Confirming</SelectItem>
                <SelectItem value="settled">Settled</SelectItem>
              </SelectContent>
            </Select>
            <Link to="/request">
              <Button variant="hero" size="sm" className="gap-2">
                <Plus className="h-4 w-4" /> New Request
              </Button>
            </Link>
          </div>
        </div>

        <div className="space-y-3">
          {filtered.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                No payments found.
              </CardContent>
            </Card>
          ) : (
            filtered.map((p, i) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
              >
                  <Card
                    className="gradient-card cursor-pointer border-border transition-all hover:border-primary/20 hover:glow-primary"
                    onClick={() => navigate(`/payment/${p.id}`)}
                  >
                    <CardContent className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-4">
                        <div>
                          <p className="font-display text-lg font-semibold">${p.amountUsd.toFixed(2)}</p>
                          <p className="font-mono text-xs text-muted-foreground">{p.amountBtc} BTC</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="hidden text-right sm:block">
                          <p className="text-sm text-muted-foreground">{p.settlementAsset}</p>
                          <p className="text-xs text-muted-foreground">
                            {p.createdAt.toLocaleDateString()}
                          </p>
                        </div>
                        <StatusBadge status={p.status} />
                        {p.txHash && (
                          <a
                            href={`https://sepolia.starkscan.co/tx/${p.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-accent hover:text-accent/80"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                      </div>
                    </CardContent>
                  </Card>
              </motion.div>
            ))
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default PaymentHistory;
