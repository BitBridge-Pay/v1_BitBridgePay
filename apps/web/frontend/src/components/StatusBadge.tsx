import { Badge } from "@/components/ui/badge";
import { Clock, Loader2, CheckCircle2, XCircle } from "lucide-react";
import type { PaymentStatus } from "@/lib/mockData";

const statusConfig: Record<PaymentStatus, { label: string; variant: "pending" | "warning" | "success" | "destructive"; icon: typeof Clock }> = {
  pending: { label: "Pending", variant: "pending", icon: Clock },
  confirming: { label: "Confirming", variant: "warning", icon: Loader2 },
  settled: { label: "Settled", variant: "success", icon: CheckCircle2 },
  expired: { label: "Expired", variant: "destructive", icon: XCircle },
};

const StatusBadge = ({ status }: { status: PaymentStatus }) => {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className="gap-1.5">
      <Icon className={`h-3 w-3 ${status === "confirming" ? "animate-spin" : ""}`} />
      {config.label}
    </Badge>
  );
};

export default StatusBadge;
