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
    () => new Contract({ abi: BITBRIDGE_ABI, address: CONTRACT_ADDRESS, providerOrAccount: provider }),
    [provider]
  );

  // Write instance: only when a wallet account is available.
  const writeContract = useMemo(
    () =>
      account
        ? new Contract({ abi: BITBRIDGE_ABI, address: CONTRACT_ADDRESS, providerOrAccount: account })
        : null,
    [account]
  );

  return { provider, readContract, writeContract };
};

// ---------------------------------------------------------------------------
// Helpers: decode the on-chain Payment struct into a plain JS object
// ---------------------------------------------------------------------------

export const decodePayment = (raw: unknown): OnChainPayment => {
  const r = raw as Record<string, unknown>;

  // starknet.js v9 deserializes u256 as a single BigInt, not { low, high }
  const txid = r.btc_txid;
  let btc_txid: { low: bigint; high: bigint };
  if (typeof txid === "bigint" || typeof txid === "number" || typeof txid === "string") {
    const val = BigInt(String(txid));
    btc_txid = { low: val & ((1n << 128n) - 1n), high: val >> 128n };
  } else {
    const obj = txid as Record<string, unknown>;
    btc_txid = { low: BigInt(String(obj.low)), high: BigInt(String(obj.high)) };
  }

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
    btc_txid,
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
