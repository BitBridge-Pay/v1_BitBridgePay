import { hash, shortString } from "starknet";
import { readEnv } from "./config.js";
import { findConfirmedPayment } from "./bitcoin.js";
import { submitAttestation } from "./starknet.js";

const config = readEnv();

// How many blocks to look back on startup to recover payments missed while
// the relayer was offline. At ~2 min/block on Starknet Sepolia, 2000 blocks
// covers roughly 2-3 days of downtime.
const LOOKBACK_BLOCKS = 2000;

// payment_id (felt252 hex string) → { btcAddress, requiredSats, merchant }
const openPayments = new Map();

// The next block to request events from. Set on first Starknet poll.
let fromBlock = null;

// Logging

function log(tag, message, data = {}) {
  const ts = new Date().toISOString();
  const extras = Object.keys(data).length ? "  " + JSON.stringify(data) : "";
  console.log(`${ts}  [${tag.padEnd(13)}]  ${message}${extras}`);
}

// Event parsing

// Starknet event key for PaymentCreated — computed from the event name.
const PAYMENT_CREATED_KEY = hash.getSelectorFromName("PaymentCreated");

// Parse a raw starknet.js event object into a structured payment record.
// Event layout (from ABI):
//   keys[0]  = event selector
//   keys[1]  = payment_id  (felt252, kind: key → indexed)
//   data[0]  = merchant    (ContractAddress)
//   data[1]  = btc_address (felt252 short-string)
//   data[2]  = required_btc_sats (u64)
//   data[3]  = amount_settlement_units (u128) — not needed by relayer
function parsePaymentCreated(event) {
  const paymentId = event.keys[1];
  const merchant = event.data[0];
  const btcAddress = shortString.decodeShortString(event.data[1]);
  const requiredSats = BigInt(event.data[2]);
  return { paymentId, merchant, btcAddress, requiredSats };
}

// Starknet polling loop
async function pollStarknetEvents() {
  const provider = config.provider;

  // On first run, anchor the cursor to LOOKBACK_BLOCKS behind the current tip
  // so payments created while the relayer was offline are picked up.
  if (fromBlock === null) {
    const tip = await provider.getBlockNumber();
    fromBlock = Math.max(0, tip - LOOKBACK_BLOCKS);
    log("STARTUP", `Replaying events from block ${fromBlock} (tip=${tip})`);
  }

  let continuationToken;
  let latestBlockSeen = fromBlock;

  do {
    const response = await provider.getEvents({
      address: config.contractAddress,
      keys: [[PAYMENT_CREATED_KEY]],
      from_block: { block_number: fromBlock },
      to_block: "latest",
      chunk_size: 100,
      continuation_token: continuationToken,
    });

    for (const event of response.events) {
      const { paymentId, merchant, btcAddress, requiredSats } =
        parsePaymentCreated(event);

      // Skip payments already tracked (idempotent on restart).
      if (!openPayments.has(paymentId)) {
        openPayments.set(paymentId, { btcAddress, requiredSats, merchant });
        log("SEEN", `New payment`, {
          paymentId,
          btcAddress,
          requiredSats: requiredSats.toString(),
          merchant,
        });
      }

      if (event.block_number != null) {
        latestBlockSeen = Math.max(latestBlockSeen, event.block_number);
      }
    }

    continuationToken = response.continuation_token;
  } while (continuationToken);

  // Advance the cursor so the next poll only fetches new events.
  // Re-processing the same block is harmless (idempotent) but wasteful.
  fromBlock = latestBlockSeen + 1;
}

// Bitcoin polling loop

async function pollBitcoin() {
  if (openPayments.size === 0) return;

  for (const [paymentId, payment] of openPayments) {
    try {
      const result = await findConfirmedPayment(
        payment.btcAddress,
        config.btcMinConfirmations,
        payment.requiredSats,
        config
      );

      if (!result) continue;

      log("BTC_CONFIRMED", `Bitcoin payment confirmed`, {
        paymentId,
        txid: result.txid,
        amountSats: result.amountSats.toString(),
        blockHeight: result.blockHeight,
      });

      log("ATTESTING", `Submitting attestation to Starknet`, { paymentId });

      const attestResult = await submitAttestation(
        config,
        paymentId,
        result.txid,
        result.amountSats,
        result.blockHeight
      );

      if (attestResult.success) {
        if (attestResult.alreadySettled) {
          log("SETTLED", `Payment was already settled (no action needed)`, {
            paymentId,
          });
        } else {
          log("SETTLED", `Payment settled on Starknet`, {
            paymentId,
            txHash: attestResult.txHash,
          });
        }
        openPayments.delete(paymentId);
      } else {
        log("FAILED", `Attestation failed`, {
          paymentId,
          error: attestResult.error,
        });
      }
    } catch (err) {
      log("FAILED", `Error processing payment`, {
        paymentId,
        error: err.message,
      });
    }
  }
}

async function main() {
  log("STARTUP", "BitBridge Pay relayer starting", {
    network: config.network,
    contract: config.contractAddress,
    pollIntervalMs: config.pollIntervalMs,
    btcPollIntervalMs: config.btcPollIntervalMs,
    btcMinConfirmations: config.btcMinConfirmations,
  });

  // Starknet event polling — runs on its own independent interval.
  (async function starknetLoop() {
    while (true) {
      try {
        await pollStarknetEvents();
        log("POLL", `Watching ${openPayments.size} open payment(s)`);
      } catch (err) {
        log("POLL_ERR", `Starknet event poll failed`, { error: err.message });
      }
      await new Promise((r) => setTimeout(r, config.pollIntervalMs));
    }
  })();

  // Bitcoin confirmation polling — runs on its own independent interval.
  (async function btcLoop() {
    // Give the Starknet loop a moment to populate openPayments before the
    // first BTC scan so we don't spin on an empty map at startup.
    await new Promise((r) => setTimeout(r, 5000));
    while (true) {
      try {
        await pollBitcoin();
      } catch (err) {
        log("BTC_ERR", `Bitcoin poll failed`, { error: err.message });
      }
      await new Promise((r) => setTimeout(r, config.btcPollIntervalMs));
    }
  })();
}

main();
