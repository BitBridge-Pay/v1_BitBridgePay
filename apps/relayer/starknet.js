import { Contract } from "starknet";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { txidToU256 } from "./bitcoin.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load the compiled ABI once at module startup — fail fast if the file is missing.
const ABI = JSON.parse(
  readFileSync(
    join(
      __dirname,
      "../../packages/contracts/target/release/bitbridge_contracts_BitBridgePay.contract_class.json"
    ),
    "utf8"
  )
).abi;

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAlreadySettled(err) {
  return String(err?.message ?? err).includes("already_settled");
}

/**
 * Submit a Bitcoin payment attestation to the BitBridgePay contract.
 *
 * Uses the attestorAccount from config to sign and send the transaction.
 * Retries up to 3 times with exponential backoff on transient failures.
 * Treats "already_settled" contract errors as success — the relayer may
 * restart and re-process events it has already handled.
 *
 * @param {object} config          - result of readEnv()
 * @param {string} paymentId       - felt252 payment ID from PaymentCreated event
 * @param {string} txid            - confirmed Bitcoin txid (64 hex chars)
 * @param {bigint} amountSats      - confirmed satoshi amount
 * @param {number} blockHeight     - Bitcoin block height of the confirming tx
 *
 * @returns {Promise<
 *   { success: true;  txHash: string } |
 *   { success: true;  alreadySettled: true } |
 *   { success: false; error: string }
 * >}
 */
export async function submitAttestation(
  config,
  paymentId,
  txid,
  amountSats,
  blockHeight
) {
  const { contractAddress, attestorAccount } = config;
  const txidU256 = txidToU256(txid);
  const contract = new Contract(ABI, contractAddress, attestorAccount);

  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // populate() encodes the calldata; account.execute() signs and broadcasts.
      const call = contract.populate("submit_attestation", {
        payment_id: paymentId,
        btc_txid: txidU256,
        btc_amount_sats: amountSats,
        btc_block_height: BigInt(blockHeight),
      });
      const result = await attestorAccount.execute(call);
      return { success: true, txHash: result.transaction_hash };
    } catch (err) {
      if (isAlreadySettled(err)) {
        // Payment was settled by a previous relayer run — treat as success.
        return { success: true, alreadySettled: true };
      }

      lastError = err;
      if (attempt < MAX_RETRIES) {
        const delayMs = BACKOFF_BASE_MS * 2 ** (attempt - 1);
        await sleep(delayMs);
      }
    }
  }

  return { success: false, error: lastError?.message ?? String(lastError) };
}
