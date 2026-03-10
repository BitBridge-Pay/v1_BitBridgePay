# BitBridgePay

![BitBridgePay](logo.jpg)

## Cross-Chain Payment Gateway: Bitcoin → Starknet (with optional private payments)

A payment gateway that accepts Bitcoin and settles STRK on Starknet. **Privacy**: merchants can use stealth BTC addresses per payment so the same address isn’t reused and payees aren’t linked on-chain.

**Simple: Customer pays BTC → Merchant gets STRK.**

---

## What It Does

- Merchant creates payment request (amount in USD/STRK)
- Customer sends Bitcoin to the generated address (or a **stealth address** for private payments)
- Relayer monitors Bitcoin via Blockstream/Xverse API and the Starknet contract for new payments
- When BTC is confirmed, relayer submits attestation to the contract
- Settlement automatically executes: STRK is sent to the merchant on Starknet
- **Private payments**: relayer derives a one-time stealth BTC address per payment; keys never leave the relayer

---

## Quick Start

### Prerequisites

- Node.js 18+
- Starknet wallet (ArgentX / Braavos)
- Testnet tokens:
  - **STRK:** https://starknet-faucet.vercel.app/
  - **BTC (testnet):** https://coinfaucet.eu/en/btc-testnet/

### Run the App

**1. Environment**

Create a `.env` at the **repo root** with:

```env
STARKNET_RPC_URL=https://sepolia.rpc.starknet.io
STARKNET_NETWORK=sepolia
CONTRACT_ADDRESS=0x00fedead01727e507fe6f5471c6c44ad4f077389f6a0865b7ce92528be6c533c
ATTESTOR_ADDRESS=<your attestor Starknet address>
ATTESTOR_PRIVATE_KEY=<your attestor private key>
BLOCKSTREAM_API_URL=https://blockstream.info/testnet/api
STEALTH_MASTER_SECRET=<long random hex string>
```

For the frontend (same file or `apps/web/frontend/.env`):

```env
VITE_STARKNET_RPC_URL=https://sepolia.rpc.starknet.io
VITE_CONTRACT_ADDRESS=0x00fedead01727e507fe6f5471c6c44ad4f077389f6a0865b7ce92528be6c533c
VITE_RELAYER_URL=http://localhost:3001
```

**2. Start relayer**

```bash
cd apps/relayer
npm install
node index.js
```

**3. Start frontend**

```bash
cd apps/web/frontend
npm install
npm run dev
```

---

## Usage

**Merchants**

1. Connect Starknet wallet (ArgentX/Braavos)
2. Go to **Request Payment**
3. Enter amount; optionally enable **private payment** (stealth address)
4. Generate QR code and show to customer

**Customers**

1. Scan QR code (or open payment link)
2. Send BTC to the shown address (e.g. from Xverse or any Bitcoin wallet)
3. Wait for confirmation
4. Merchant receives STRK on Starknet automatically

---

## Deployed Contracts

**Network:** Starknet Sepolia Testnet

| Contract         | Address                                                              |
| ---------------- | -------------------------------------------------------------------- |
| BitBridgePay     | `0x00fedead01727e507fe6f5471c6c44ad4f077389f6a0865b7ce92528be6c533c` |
| Oracle (Pragma)  | `0x36031daa264c24520b11d93af622c848b2499b66b41d611bac95e13cfca131a`  |
| Settlement Token | `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` |

View on [Starkscan](https://sepolia.starkscan.co/) (search by address).

---

## Tech Stack

| Layer     | Stack                                        |
| --------- | -------------------------------------------- |
| Frontend  | React, Vite, Tailwind/shadcn, StarknetKit    |
| Relayer   | Node.js, starknet.js, bitcoinjs-lib          |
| Contracts | Cairo (Starknet), Pragma oracle              |
| APIs      | Blockstream / Xverse (Bitcoin), Starknet RPC |

---

## How It Works

```
Customer (BTC)  →  Relayer  →  Merchant (STRK)
      │                │              │
  Send BTC        Monitor BTC     Receive STRK
  to address      + attest        on Starknet
                  on Starknet
```

- **Bitcoin:** Relayer watches Blockstream/Xverse for incoming txs to payment addresses (or derived stealth addresses).
- **Starknet:** Contract stores payment requests; relayer calls `submit_attestation` after BTC confirmation; contract settles STRK to merchant.
- **Privacy:** For private payments, relayer derives a stealth BTC address per request; only the relayer can map address → payment.

---
