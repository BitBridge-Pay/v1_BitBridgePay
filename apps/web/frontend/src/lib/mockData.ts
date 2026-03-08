export type PaymentStatus = "pending" | "confirming" | "settled" | "expired";
export type SettlementAsset = "STRK" | "USDC";

export interface PaymentRequest {
  id: string;
  paymentId: string;
  amountUsd: number;
  amountBtc: number;
  btcAddress: string;
  status: PaymentStatus;
  settlementAsset: SettlementAsset;
  settlementChain: string;
  createdAt: Date;
  settledAt?: Date;
  txHash?: string;
}
