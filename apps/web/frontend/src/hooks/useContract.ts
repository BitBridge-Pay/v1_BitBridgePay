import { useMemo } from "react";
import { Contract, RpcProvider } from "starknet";
import { useWallet } from "./useWallet";
import { BITBRIDGE_ABI, CONTRACT_ADDRESS, RPC_URL } from "@/lib/contract";
import type { OnChainPayment } from "@/lib/contract";

// ---------------------------------------------------------------------------
// useContract
//
// Returns:
//   readContract  — connected to the public RPC provider (view calls, no wallet)
//   writeContract — connected to the user's wallet account (invoke calls)
//                   null when wallet is not connected
// ---------------------------------------------------------------------------

export const useContract = () => {
  const { account } = useWallet();

  const provider = useMemo(() => new RpcProvider({ nodeUrl: RPC_URL }), []);

  // Read-only instance: always available, no wallet required.
  const readContract = useMemo(
    () => new Contract(BITBRIDGE_ABI as unknown as object[], CONTRACT_ADDRESS, provider),
    [provider]
  );

  // Write instance: only when a wallet account is available.
  const writeContract = useMemo(
    () =>
      account
        ? new Contract(BITBRIDGE_ABI as unknown as object[], CONTRACT_ADDRESS, account)
        : null,
    [account]
  );

  return { readContract, writeContract };
};

// ---------------------------------------------------------------------------
// Helpers: decode the on-chain Payment struct into a plain JS object
// ---------------------------------------------------------------------------

export const decodePayment = (raw: unknown): OnChainPayment => {
  const r = raw as Record<string, unknown>;
  return {
    initialized: Boolean(r.initialized),
    merchant: String(r.merchant),
    amount_settlement_units: BigInt(String(r.amount_settlement_units)),
    btc_address: String(r.btc_address),
    required_btc_sats: BigInt(String(r.required_btc_sats)),
    settled: Boolean(r.settled),
    expires_at: BigInt(String(r.expires_at)),
    btc_block_height: BigInt(String(r.btc_block_height)),
    cancelled: Boolean(r.cancelled),
    btc_txid: {
      low: BigInt(String((r.btc_txid as Record<string, unknown>).low)),
      high: BigInt(String((r.btc_txid as Record<string, unknown>).high)),
    },
    is_private: Boolean(r.is_private),
  };
};

// ---------------------------------------------------------------------------
// Helpers: unit conversions
// ---------------------------------------------------------------------------

// Convert STRK base units (u128, 18 decimals) to a human-readable string.
export const strkFromUnits = (units: bigint): string => {
  const whole = units / 10n ** 18n;
  const frac = units % 10n ** 18n;
  const fracStr = frac.toString().padStart(18, "0").slice(0, 6).replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
};

// Convert satoshis (u64) to BTC string.
export const btcFromSats = (sats: bigint): string => {
  const whole = sats / 100_000_000n;
  const frac = sats % 100_000_000n;
  const fracStr = frac.toString().padStart(8, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
};
