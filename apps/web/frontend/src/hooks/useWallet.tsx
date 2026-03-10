import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  ReactNode,
} from "react";
import { connect, disconnect as starknetKitDisconnect } from "starknetkit";
import type { StarknetkitConnector } from "starknetkit";
import type { AccountInterface } from "starknet";
import { RpcProvider } from "starknet";
import { RPC_URL } from "@/lib/contract";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// chainType is designed for future multi-chain support (EVM via wagmi later).
export type ChainType = "starknet" | "evm";
export type NetworkName = "sepolia" | "mainnet";

interface WalletContextType {
  address: string | null;
  account: AccountInterface | null;
  isConnected: boolean;
  isConnecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  network: NetworkName;
  setNetwork: (n: NetworkName) => void;
  chainType: ChainType;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const WalletContext = createContext<WalletContextType | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const WalletProvider = ({ children }: { children: ReactNode }) => {
  const [address, setAddress] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountInterface | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connector, setConnector] = useState<StarknetkitConnector | null>(null);

  const [network, setNetwork] = useState<NetworkName>("sepolia");
  const chainType: ChainType = "starknet";

  const provider = useMemo(() => new RpcProvider({ nodeUrl: RPC_URL }), []);

  // Resolve account from connector and update state
  const resolveAccount = useCallback(
    async (c: StarknetkitConnector, addr: string) => {
      try {
        const acc = await c.account(provider);
        setConnector(c);
        setAddress(addr);
        setAccount(acc);
      } catch (err) {
        console.error("[useWallet] resolveAccount failed:", err);
        // Keep the address visible even if account resolution fails —
        // the user is still "connected" from the wallet's perspective.
        setConnector(c);
        setAddress(addr);
        setAccount(null);
      }
    },
    [provider]
  );

  // On mount: try to reconnect silently if the user was previously connected.
  // Wrapped in try/catch because starknetkit probes all injected extensions
  // (including Polkadot.js) and non-Starknet wallets reject with UserRejectedRequestError.
  useEffect(() => {
    const tryReconnect = async () => {
      try {
        const result = await connect({
          modalMode: "neverAsk",
          modalTheme: "dark",
          dappName: "BitBridgePay",
        });
        if (result.connector && result.connectorData?.account) {
          await resolveAccount(result.connector, result.connectorData.account);
        }
      } catch {
        // Non-Starknet extension rejected the probe — ignore, user was not connected.
      }
    };
    tryReconnect();
  }, [resolveAccount]);

  // Wire up connector events so we react to account/chain changes in the wallet.
  useEffect(() => {
    if (!connector) return;

    const handleChange = async ({ account: newAddr }: { account?: string; chainId?: bigint }) => {
      if (newAddr) {
        await resolveAccount(connector, newAddr);
      } else {
        setAddress(null);
        setAccount(null);
      }
    };

    const handleDisconnect = () => {
      setAddress(null);
      setAccount(null);
      setConnector(null);
    };

    connector.on("change", handleChange);
    connector.on("disconnect", handleDisconnect);

    return () => {
      connector.off("change", handleChange);
      connector.off("disconnect", handleDisconnect);
    };
  }, [connector, resolveAccount]);

  const connectWallet = useCallback(async () => {
    setIsConnecting(true);
    try {
      const result = await connect({
        modalMode: "alwaysAsk",
        modalTheme: "dark",
        dappName: "BitBridgePay",
        connectors: undefined, // use starknetkit defaults (ArgentX, Braavos, web wallet)
      });
      if (result.connector && result.connectorData?.account) {
        await resolveAccount(result.connector, result.connectorData.account);
      }
    } catch (err) {
      console.error("[useWallet] connect failed:", err);
    } finally {
      setIsConnecting(false);
    }
  }, [resolveAccount]);

  const disconnectWallet = useCallback(() => {
    starknetKitDisconnect({ clearLastWallet: true });
    setAddress(null);
    setAccount(null);
    setConnector(null);
  }, []);

  return (
    <WalletContext.Provider
      value={{
        address,
        account,
        isConnected: !!address,
        isConnecting,
        connect: connectWallet,
        disconnect: disconnectWallet,
        network,
        setNetwork,
        chainType,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useWallet = () => {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
};
