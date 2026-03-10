// BitBridgePay contract config: ABI, deployed addresses, and network constants.
// The ABI is derived directly from the compiled Cairo contract.
import type { Abi } from "starknet";

export const DEPLOYED = {
  sepolia: {
    BitBridgePay: "0x00fedead01727e507fe6f5471c6c44ad4f077389f6a0865b7ce92528be6c533c",
    oracle: "0x36031daa264c24520b11d93af622c848b2499b66b41d611bac95e13cfca131a",
    settlementToken: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    settlementTokenSymbol: "STRK" as const,
  },
} as const;

// Starknet chain IDs
export const CHAIN_IDS = {
  sepolia: BigInt("0x534e5f5345504f4c4941"), // SN_SEPOLIA
  mainnet: BigInt("0x534e5f4d41494e"),        // SN_MAIN
} as const;

// RPC endpoint from env (set in .env as VITE_STARKNET_RPC_URL)
export const RPC_URL = import.meta.env.VITE_STARKNET_RPC_URL as string;

// Contract address from env (falls back to deployed_addresses.json value)
export const CONTRACT_ADDRESS =
  (import.meta.env.VITE_CONTRACT_ADDRESS as string) ||
  DEPLOYED.sepolia.BitBridgePay;

// Relayer base URL for stealth BTC address generation
export const RELAYER_URL = import.meta.env.VITE_RELAYER_URL as string;

// STRK has 18 decimals
export const STRK_DECIMALS = 18n;

// Full ABI from compiled bitbridge_contracts_BitBridgePay.contract_class.json
export const BITBRIDGE_ABI: Abi = [
  {
    type: "impl",
    name: "BitBridgePayImpl",
    interface_name: "bitbridge_contracts::IBitBridgePay",
  },
  {
    type: "struct",
    name: "core::byte_array::ByteArray",
    members: [
      { name: "data", type: "core::array::Array::<core::bytes_31::bytes31>" },
      { name: "pending_word", type: "core::felt252" },
      { name: "pending_word_len", type: "core::integer::u32" },
    ],
  },
  {
    type: "enum",
    name: "core::bool",
    variants: [
      { name: "False", type: "()" },
      { name: "True", type: "()" },
    ],
  },
  {
    type: "struct",
    name: "core::integer::u256",
    members: [
      { name: "low", type: "core::integer::u128" },
      { name: "high", type: "core::integer::u128" },
    ],
  },
  {
    type: "struct",
    name: "bitbridge_contracts::BitBridgePay::Payment",
    members: [
      { name: "initialized", type: "core::bool" },
      { name: "merchant", type: "core::starknet::contract_address::ContractAddress" },
      { name: "amount_settlement_units", type: "core::integer::u128" },
      { name: "btc_address", type: "core::byte_array::ByteArray" },
      { name: "required_btc_sats", type: "core::integer::u64" },
      { name: "settled", type: "core::bool" },
      { name: "expires_at", type: "core::integer::u64" },
      { name: "btc_block_height", type: "core::integer::u64" },
      { name: "cancelled", type: "core::bool" },
      { name: "btc_txid", type: "core::integer::u256" },
      { name: "is_private", type: "core::bool" },
    ],
  },
  {
    type: "interface",
    name: "bitbridge_contracts::IBitBridgePay",
    items: [
      {
        type: "function",
        name: "create_payment",
        inputs: [
          { name: "merchant", type: "core::starknet::contract_address::ContractAddress" },
          { name: "amount_settlement_units", type: "core::integer::u128" },
          { name: "payment_id", type: "core::felt252" },
          { name: "btc_address", type: "core::byte_array::ByteArray" },
          { name: "required_btc_sats", type: "core::integer::u64" },
          { name: "is_private", type: "core::bool" },
        ],
        outputs: [],
        state_mutability: "external",
      },
      {
        type: "function",
        name: "submit_attestation",
        inputs: [
          { name: "payment_id", type: "core::felt252" },
          { name: "btc_txid", type: "core::integer::u256" },
          { name: "btc_amount_sats", type: "core::integer::u64" },
          { name: "btc_block_height", type: "core::integer::u64" },
        ],
        outputs: [],
        state_mutability: "external",
      },
      {
        type: "function",
        name: "cancel_payment",
        inputs: [{ name: "payment_id", type: "core::felt252" }],
        outputs: [],
        state_mutability: "external",
      },
      {
        type: "function",
        name: "get_payment",
        inputs: [{ name: "payment_id", type: "core::felt252" }],
        outputs: [{ type: "bitbridge_contracts::BitBridgePay::Payment" }],
        state_mutability: "view",
      },
      {
        type: "function",
        name: "get_attestor",
        inputs: [],
        outputs: [{ type: "core::starknet::contract_address::ContractAddress" }],
        state_mutability: "view",
      },
      {
        type: "function",
        name: "get_oracle_address",
        inputs: [],
        outputs: [{ type: "core::starknet::contract_address::ContractAddress" }],
        state_mutability: "view",
      },
      {
        type: "function",
        name: "get_settlement_token",
        inputs: [],
        outputs: [{ type: "core::starknet::contract_address::ContractAddress" }],
        state_mutability: "view",
      },
      {
        type: "function",
        name: "get_settlement_pair_id",
        inputs: [],
        outputs: [{ type: "core::felt252" }],
        state_mutability: "view",
      },
      {
        type: "function",
        name: "get_settlement_token_decimals",
        inputs: [],
        outputs: [{ type: "core::integer::u32" }],
        state_mutability: "view",
      },
    ],
  },
  {
    type: "event",
    name: "bitbridge_contracts::BitBridgePay::PaymentCreated",
    kind: "struct",
    members: [
      { name: "payment_id", type: "core::felt252", kind: "key" },
      { name: "merchant", type: "core::starknet::contract_address::ContractAddress", kind: "data" },
      { name: "btc_address", type: "core::byte_array::ByteArray", kind: "data" },
      { name: "required_btc_sats", type: "core::integer::u64", kind: "data" },
      { name: "amount_settlement_units", type: "core::integer::u128", kind: "data" },
      { name: "is_private", type: "core::bool", kind: "data" },
    ],
  },
  {
    type: "event",
    name: "bitbridge_contracts::BitBridgePay::PaymentSettled",
    kind: "struct",
    members: [
      { name: "payment_id", type: "core::felt252", kind: "key" },
      { name: "merchant", type: "core::starknet::contract_address::ContractAddress", kind: "data" },
      { name: "amount_settlement_units", type: "core::integer::u256", kind: "data" },
      { name: "btc_txid", type: "core::integer::u256", kind: "data" },
    ],
  },
  {
    type: "event",
    name: "bitbridge_contracts::BitBridgePay::PaymentCancelled",
    kind: "struct",
    members: [
      { name: "payment_id", type: "core::felt252", kind: "key" },
      { name: "merchant", type: "core::starknet::contract_address::ContractAddress", kind: "data" },
    ],
  },
  {
    type: "event",
    name: "bitbridge_contracts::BitBridgePay::Event",
    kind: "enum",
    variants: [
      { name: "PaymentCreated", type: "bitbridge_contracts::BitBridgePay::PaymentCreated", kind: "nested" },
      { name: "PaymentSettled", type: "bitbridge_contracts::BitBridgePay::PaymentSettled", kind: "nested" },
      { name: "PaymentCancelled", type: "bitbridge_contracts::BitBridgePay::PaymentCancelled", kind: "nested" },
    ],
  },
];

// TypeScript type for the on-chain Payment struct
export interface OnChainPayment {
  initialized: boolean;
  merchant: string;
  amount_settlement_units: bigint;
  btc_address: string;
  required_btc_sats: bigint;
  settled: boolean;
  expires_at: bigint;
  btc_block_height: bigint;
  cancelled: boolean;
  btc_txid: { low: bigint; high: bigint };
  is_private: boolean;
}
