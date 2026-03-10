import axios from "axios";

// ---------------------------------------------------------------------------
// Internal fetch helpers
// ---------------------------------------------------------------------------

// Xverse API uses a /v1/bitcoin/ path prefix and requires an x-api-key header.
async function fetchFromXverse(config, address) {
  const base = config.xverseApiUrl;
  const headers = { "x-api-key": config.xverseApiKey };
  const [utxoRes, tipRes] = await Promise.all([
    axios.get(`${base}/v1/bitcoin/address/${address}/utxo`, { headers }),
    axios.get(`${base}/v1/bitcoin/blocks/tip/height`, { headers }),
  ]);
  return {
    utxos: utxoRes.data,
    tipHeight: parseInt(tipRes.data, 10),
  };
}

// Blockstream API — no auth, path directly off the base URL.
async function fetchFromBlockstream(config, address) {
  const base = config.blockstreamApiUrl;
  const [utxoRes, tipRes] = await Promise.all([
    axios.get(`${base}/address/${address}/utxo`),
    axios.get(`${base}/blocks/tip/height`),
  ]);
  return {
    utxos: utxoRes.data,
    tipHeight: parseInt(tipRes.data, 10),
  };
}

// Try Xverse first (when API key is configured); fall back to Blockstream.
async function fetchBitcoinData(config, address) {
  if (config.xverseApiKey) {
    try {
      return await fetchFromXverse(config, address);
    } catch (_) {
      // Xverse unavailable — fall through to Blockstream
    }
  }
  return await fetchFromBlockstream(config, address);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the total confirmed sats received at an address
 * (sum of all UTXOs with >= minConfirmations).
 */
export async function getConfirmedStats(address, config, minConfirmations) {
  try {
    const { utxos, tipHeight } = await fetchBitcoinData(config, address);
    let totalSats = 0n;
    for (const utxo of utxos) {
      if (!utxo.status.confirmed) continue;
      const confirmations = tipHeight - utxo.status.block_height + 1;
      if (confirmations >= minConfirmations) {
        totalSats += BigInt(utxo.value);
      }
    }
    return totalSats;
  } catch (error) {
    throw new Error(`Bitcoin API error: ${error.message || error.code || String(error)}`);
  }
}

/**
 * Returns the first UTXO that meets the required confirmation depth and
 * satoshi amount, or null if no such UTXO exists yet.
 */
export async function findConfirmedPayment(
  address,
  minConfirmations,
  requiredSats,
  config
) {
  try {
    const { utxos, tipHeight } = await fetchBitcoinData(config, address);
    for (const utxo of utxos) {
      // When minConfirmations === 0, accept mempool (unconfirmed) UTXOs immediately.
      if (!utxo.status.confirmed && minConfirmations > 0) continue;
      const confirmations = utxo.status.confirmed
        ? tipHeight - utxo.status.block_height + 1
        : 0;
      if (
        confirmations >= minConfirmations &&
        BigInt(utxo.value) >= requiredSats
      ) {
        return {
          txid: utxo.txid,
          amountSats: BigInt(utxo.value),
          blockHeight: utxo.status.block_height ?? 0,
        };
      }
    }
    return null;
  } catch (error) {
    throw new Error(`Bitcoin API error: ${error.message || error.code || String(error)}`);
  }
}

/**
 * Convert a 64-char hex Bitcoin txid to a u256 { low, high } for the contract.
 */
export function txidToU256(txid) {
  if (!txid || typeof txid !== "string" || txid.length !== 64) {
    throw new Error("Invalid Bitcoin transaction ID");
  }
  const value = BigInt("0x" + txid);
  return {
    low: value & ((1n << 128n) - 1n),
    high: value >> 128n,
  };
}
