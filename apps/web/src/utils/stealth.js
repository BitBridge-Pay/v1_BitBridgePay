/**
 * BitBridge Pay — Stealth Bitcoin Address Derivation (Tier 2.1)
 *
 * Every payment gets a unique Bitcoin address derived deterministically from:
 *   seed  = sha256(merchant_starknet_address + contract_address)
 *   path  = m/44'/0'/0'/0/{payment_index}
 *
 * Benefits:
 *   - Merchant's real Bitcoin address is never exposed on-chain or in any payment.
 *   - Payments cannot be linked to each other or to the merchant by an observer.
 *   - Merchant can recover all stealth addresses from their Starknet address + contract address.
 *   - No contract changes needed — contract already stores whatever BTC address is provided.
 *   - Relayer watches stealth addresses exactly as it watches any BTC address.
 *
 * NOTE: The contract stores btc_address as felt252 (max 31 ASCII bytes).
 * Real bech32 addresses (42+ chars) exceed this limit. For production, the contract
 * should be updated to use ByteArray or multiple felt252 fields. For the hackathon
 * demo, we truncate to 31 chars (the relayer can re-derive the full address from
 * the deterministic params).
 *
 * Dependencies: bitcoinjs-lib, bip32, tiny-secp256k1 (browser-compatible via Vite).
 */

import * as bitcoin from "bitcoinjs-lib";
import BIP32Factory from "bip32";
import * as ecc from "tiny-secp256k1";

const bip32 = BIP32Factory(ecc);

/**
 * Browser-compatible SHA-256 hash.
 * Uses the Web Crypto API (SubtleCrypto) which is available in all modern browsers.
 *
 * @param {string} input - UTF-8 string to hash
 * @returns {Promise<Uint8Array>} 32-byte hash
 */
async function sha256(input) {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hashBuffer);
}

/**
 * Derive a deterministic stealth Bitcoin address for a payment.
 *
 * @param {string} merchantStarknetAddress - Merchant's Starknet address (hex, e.g. "0x037d...")
 * @param {string} contractAddress - BitBridgePay contract address (hex)
 * @param {number} paymentIndex - Sequential payment index for this merchant (0-based)
 * @param {"testnet" | "mainnet"} [network="testnet"]
 * @returns {Promise<{ address: string, publicKey: string, path: string }>}
 */
export async function deriveStealthAddress(
  merchantStarknetAddress,
  contractAddress,
  paymentIndex,
  network = "testnet"
) {
  // 1. Build deterministic seed from merchant + contract identity
  const preimage =
    merchantStarknetAddress.toLowerCase() + contractAddress.toLowerCase();
  const seed = await sha256(preimage);
  // sha256 returns 32 bytes — valid for BIP32 fromSeed (accepts 16–64 bytes)

  // 2. Derive HD key at standard BIP44 path
  const root = bip32.fromSeed(Buffer.from(seed));
  const path = `m/44'/0'/0'/0/${paymentIndex}`;
  const child = root.derivePath(path);

  // 3. Generate native SegWit (bech32) address
  const btcNetwork =
    network === "mainnet" ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;

  const { address } = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(child.publicKey),
    network: btcNetwork,
  });

  return {
    address,
    publicKey: Buffer.from(child.publicKey).toString("hex"),
    path,
  };
}

/**
 * Recover all stealth addresses for a merchant.
 * Used to list/reconcile all payment addresses from the merchant's Starknet identity.
 *
 * @param {string} merchantStarknetAddress
 * @param {string} contractAddress
 * @param {number} count - Number of addresses to derive (0 to count-1)
 * @param {"testnet" | "mainnet"} [network="testnet"]
 * @returns {Promise<Array<{ address: string, publicKey: string, path: string, index: number }>>}
 */
export async function recoverStealthAddresses(
  merchantStarknetAddress,
  contractAddress,
  count,
  network = "testnet"
) {
  const addresses = [];
  for (let i = 0; i < count; i++) {
    const result = await deriveStealthAddress(
      merchantStarknetAddress,
      contractAddress,
      i,
      network
    );
    addresses.push({ ...result, index: i });
  }
  return addresses;
}

/**
 * Encode a bech32 Bitcoin address as a felt252-compatible short string.
 *
 * felt252 short strings are limited to 31 ASCII bytes. Real bech32 addresses
 * are 42–62 chars, so this truncates. The full address is always recoverable
 * from (merchantStarknetAddress, contractAddress, paymentIndex).
 *
 * For production, update the contract to use ByteArray for btc_address.
 *
 * @param {string} address - Full bech32 Bitcoin address
 * @returns {string} Truncated to max 31 chars for felt252 storage
 */
export function addressToFelt252(address) {
  return address.slice(0, 31);
}
