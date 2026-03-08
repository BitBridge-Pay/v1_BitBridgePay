import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Zap, Shield, Globe, Bitcoin, Wallet } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { motion } from "framer-motion";

const features = [
  {
    icon: Bitcoin,
    title: "Pay in Bitcoin",
    description: "Customers pay with BTC from any wallet. No new tools to learn.",
  },
  {
    icon: Shield,
    title: "Fully On-Chain",
    description: "No trusted backend. Settlement is verified and executed on-chain.",
  },
  {
    icon: Globe,
    title: "Cross-Chain Settlement",
    description: "Receive STRK or USDC on Starknet. More chains coming in v2.",
  },
];

const Index = () => {
  const { isConnected, connect } = useWallet();

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col">
      {/* Hero */}
      <section className="relative flex flex-1 flex-col items-center justify-center px-4 py-24 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="relative z-10 max-w-3xl"
        >
          <Badge variant="testnet" className="mb-6">
            <Zap className="mr-1 h-3 w-3" /> Live on Starknet Sepolia
          </Badge>

          <h1 className="mb-6 font-display text-5xl font-bold leading-tight tracking-tight md:text-7xl">
            Accept <span className="text-gradient-hero">Bitcoin</span>,<br />
            settle anywhere
          </h1>

          <p className="mx-auto mb-10 max-w-xl text-lg text-muted-foreground">
            A trustless cross-chain payment gateway. Your customer pays in BTC,
            you receive STRK or USDC — no intermediary, fully on-chain.
          </p>

          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            {isConnected ? (
              <Link to="/request">
                <Button variant="hero" size="lg" className="gap-2 text-base">
                  Create Payment Request
                  <ArrowRight className="h-5 w-5" />
                </Button>
              </Link>
            ) : (
              <Button variant="hero" size="lg" onClick={connect} className="gap-2 text-base">
                <Wallet className="h-5 w-5" />
                Connect Wallet
              </Button>
            )}
            <Link to="/pay/demo">
              <Button variant="outline" size="lg" className="gap-2 text-base">
                Pay a Request
                <ArrowRight className="h-5 w-5" />
              </Button>
            </Link>
          </div>
        </motion.div>
      </section>

      {/* Features */}
      <section className="border-t border-border bg-card/50 px-4 py-20">
        <div className="container grid max-w-5xl gap-8 md:grid-cols-3">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 + i * 0.1 }}
              className="rounded-xl border border-border bg-card p-6"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <f.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="mb-2 font-display text-lg font-semibold">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.description}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border px-4 py-6 text-center text-sm text-muted-foreground">
        BitBridgePay — Trustless cross-chain payments. Settlement is on-chain.
      </footer>
    </div>
  );
};

export default Index;
