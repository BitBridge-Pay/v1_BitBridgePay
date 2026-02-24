import dotenv from "dotenv";
import { RpcProvider, Account } from "starknet";
dotenv.config();

export function readEnv() {
  // 1. Read all variables
  const rpcUrl = process.env.STARKNET_RPC_URL;
  const network = process.env.STARKNET_NETWORK;
  const contractAddress = process.env.CONTRACT_ADDRESS;
  const attestorAddress = process.env.ATTESTOR_ADDRESS;
  const attestorPrivateKey = process.env.ATTESTOR_PRIVATE_KEY;
  const blockstreamApiUrl = process.env.BLOCKSTREAM_API_URL;
  const btcMinConfirmations = parseInt(process.env.BTC_MIN_CONFIRMATIONS || "1", 10);
  const pollIntervalMs = parseInt(process.env.POLL_INTERVAL_MS || "30000", 10);
  const btcPollIntervalMs = parseInt(process.env.BTC_POLL_INTERVAL_MS || "60000", 10);
  const logLevel = process.env.LOG_LEVEL || "info";

  // 2. Validate required variables — fail early with a clear message
  if (!rpcUrl)            throw new Error("Missing STARKNET_RPC_URL");
  if (!network)           throw new Error("Missing STARKNET_NETWORK");
  if (!contractAddress)   throw new Error("Missing CONTRACT_ADDRESS");
  if (!attestorAddress)   throw new Error("Missing ATTESTOR_ADDRESS");
  if (!attestorPrivateKey) throw new Error("Missing ATTESTOR_PRIVATE_KEY");
  if (!blockstreamApiUrl) throw new Error("Missing BLOCKSTREAM_API_URL");

  // 3. Build the signer — private key is consumed here and never returned
  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  const attestorAccount = new Account(provider, attestorAddress, attestorPrivateKey);

  // 4. Return config — raw private key is not exposed
  return {
    rpcUrl,
    network,
    contractAddress,
    attestorAccount,
    blockstreamApiUrl,
    btcMinConfirmations,
    pollIntervalMs,
    btcPollIntervalMs,
    logLevel,
  };
}
