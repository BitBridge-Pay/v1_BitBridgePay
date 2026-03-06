/**
 * BitBridge Pay — Operator-Held Stealth Address Derivation
 *
 * Stealth address private keys are derived using a secret only the relayer
 * holds (STEALTH_MASTER_SECRET). This means:
 *   - Only the relayer can spend from stealth addresses (needed for refunds).
 *   - The merchant cannot derive private keys — they reconcile via Starknet events.
 *   - An observer knowing the merchant's Starknet address cannot derive private keys.
 *
 * Derivation:
 *   seed = HMAC-SHA256(STEALTH_MASTER_SECRET, merchantAddress + contractAddress)
 *   path = m/44'/0'/0'/0/{paymentIndex}
 *
 * The relayer exposes a /api/stealth-address endpoint that returns the address
 * (never the private key) so the frontend can include it in create_payment.
 */

import * as bitcoin from "bitcoinjs-lib";
import BIP32Factory from "bip32";
import * as ecc from "tiny-secp256k1";
import { createHmac } from "crypto";

const bip32 = BIP32Factory(ecc);

/**
 * Internal: derive both address and private key.
 */
function derive(masterSecret, merchantAddress, contractAddress, paymentIndex, network) {
  const seed = createHmac("sha256", Buffer.from(masterSecret, "hex"))
    .update(merchantAddress.toLowerCase() + contractAddress.toLowerCase())
    .digest();

  const btcNetwork =
    network === "mainnet" ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;

  const root = bip32.fromSeed(seed, btcNetwork);
  const path = `m/44'/0'/0'/0/${paymentIndex}`;
  const child = root.derivePath(path);

  const { address } = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(child.publicKey),
    network: btcNetwork,
  });

  return { address, privateKey: child.privateKey, path };
}

/**
 * Returns only the Bitcoin address for a given payment.
 * Safe to send to the frontend — private key is never included.
 *
 * @param {object} config       - result of readEnv()
 * @param {string} merchantAddress  - merchant's Starknet address
 * @param {number} paymentIndex     - sequential index (0-based) for this merchant
 * @returns {{ address: string, path: string }}
 */
export function getStealthAddress(config, merchantAddress, paymentIndex) {
  const { address, path } = derive(
    config.stealthMasterSecret,
    merchantAddress,
    config.contractAddress,
    paymentIndex,
    config.btcNetwork
  );
  return { address, path };
}

/**
 * Returns the private key for a stealth address — used by the refund sweeper only.
 * Never call this from any HTTP handler.
 *
 * @param {object} config
 * @param {string} merchantAddress
 * @param {number} paymentIndex
 * @returns {{ privateKey: Buffer, address: string }}
 */
export function getStealthPrivateKey(config, merchantAddress, paymentIndex) {
  const { privateKey, address } = derive(
    config.stealthMasterSecret,
    merchantAddress,
    config.contractAddress,
    paymentIndex,
    config.btcNetwork
  );
  return { privateKey, address };
}
