import axios from "axios";
// Returns the total confirmed sats received at an address
// (sum of all UTXOs with >= minConfirmations)
export async function getConfirmedStats(address, apiUrl, minConfirmations) {
  try {
    if (!address || !apiUrl || !minConfirmations) {
      throw new Error(
        "Missing required parameters: address, apiUrl, or minConfirmations"
      );
    }
    // 1. Fetch current block tip height
    const tipRes = await axios.get(`${apiUrl}/blocks/tip/height`);
    const tipHeight = parseInt(tipRes.data, 10);
    // 2. Fetch UTXOs for the address
    const utxoRes = await axios.get(`${apiUrl}/address/${address}/utxo`);
    // 3. Sum confirmed sats
    let totalSats = 0n;
    for (const utxo of utxoRes.data) {
      if (utxo.status.confirmed === false) continue;
      const confirmations = tipHeight - utxo.status.block_height + 1;
      if (confirmations >= minConfirmations) {
        totalSats += BigInt(utxo.value);
      }
    }
    return totalSats;
  } catch (error) {
    throw new Error(`Bitcoin API error: ${error.message}`);
  }
}
