/**
 * BitBridge Pay — Stealth Address Client
 *
 * The stealth address private key is held exclusively by the relayer
 * (derived using STEALTH_MASTER_SECRET). This file only fetches the
 * public Bitcoin address from the relayer API — the private key never
 * leaves the relayer process.
 *
 * Privacy model:
 *   - Each payment gets a unique Bitcoin address → payments are unlinkable
 *     to casual on-chain observers.
 *   - The merchant reconciles via Starknet events (PaymentCreated/PaymentSettled),
 *     not by re-deriving Bitcoin addresses.
 *   - Only the relayer can spend from stealth addresses (needed for refunds).
 */

const RELAYER_URL = import.meta.env.VITE_RELAYER_URL ?? "http://localhost:3001";

/**
 * Fetch a stealth Bitcoin address for a payment from the relayer.
 *
 * @param {string} merchantAddress - Merchant's Starknet address (hex)
 * @param {number} paymentIndex    - Sequential index for this merchant (0-based)
 * @returns {Promise<{ address: string, index: number, path: string }>}
 */
export async function deriveStealthAddress(merchantAddress, paymentIndex) {
  const url = `${RELAYER_URL}/api/stealth-address?merchant=${encodeURIComponent(merchantAddress)}&index=${paymentIndex}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Relayer error: ${body.error ?? res.statusText}`);
  }
  return res.json(); // { address, index, path }
}

/**
 * Fetch multiple stealth addresses for a merchant (e.g. for history display).
 *
 * @param {string} merchantAddress
 * @param {number} count - How many addresses to fetch (indices 0..count-1)
 * @returns {Promise<Array<{ address: string, index: number, path: string }>>}
 */
export async function fetchStealthAddresses(merchantAddress, count) {
  return Promise.all(
    Array.from({ length: count }, (_, i) => deriveStealthAddress(merchantAddress, i))
  );
}
