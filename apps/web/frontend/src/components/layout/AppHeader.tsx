import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Wallet, Zap, Settings, History, LogOut, Menu } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";

const AppHeader = () => {
  const location = useLocation();
  const { address, isConnected, connect, disconnect } = useWallet();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems = [
    { path: "/", label: "Home", icon: Zap },
    ...(isConnected
      ? [
          { path: "/request", label: "Request Payment", icon: Wallet },
          { path: "/history", label: "History", icon: History },
          { path: "/settings", label: "Settings", icon: Settings },
        ]
      : []),
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-hero">
              <Zap className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-display text-lg font-bold text-foreground">
              BitBridge<span className="text-primary">Pay</span>
            </span>
          </Link>
          <Badge variant="testnet" className="hidden text-[10px] sm:inline-flex">Sepolia Testnet</Badge>
        </div>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 md:flex">
          {navItems.map((item) => (
            <Link key={item.path} to={item.path}>
              <Button
                variant={location.pathname === item.path ? "secondary" : "ghost"}
                size="sm"
                className="gap-2"
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Button>
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {/* Wallet controls — desktop */}
          <div className="hidden items-center gap-2 md:flex">
            {isConnected ? (
              <>
                <Badge variant="outline" className="font-mono text-xs">
                  {address?.slice(0, 6)}...{address?.slice(-4)}
                </Badge>
                <Button variant="ghost" size="icon" onClick={disconnect}>
                  <LogOut className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <Button variant="hero" size="sm" onClick={connect} className="gap-2">
                <Wallet className="h-4 w-4" />
                Connect Wallet
              </Button>
            )}
          </div>

          {/* Mobile hamburger */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <div className="flex flex-col gap-6 pt-6">
                {/* Nav links */}
                <nav className="flex flex-col gap-1">
                  {navItems.map((item) => (
                    <Link key={item.path} to={item.path} onClick={() => setMobileOpen(false)}>
                      <Button
                        variant={location.pathname === item.path ? "secondary" : "ghost"}
                        size="sm"
                        className="w-full justify-start gap-2"
                      >
                        <item.icon className="h-4 w-4" />
                        {item.label}
                      </Button>
                    </Link>
                  ))}
                </nav>

                {/* Wallet controls — mobile */}
                <div className="border-t border-border pt-4">
                  {isConnected ? (
                    <div className="space-y-3">
                      <Badge variant="outline" className="w-full justify-center font-mono text-xs">
                        {address?.slice(0, 6)}...{address?.slice(-4)}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full gap-2"
                        onClick={() => { disconnect(); setMobileOpen(false); }}
                      >
                        <LogOut className="h-4 w-4" /> Disconnect
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="hero"
                      size="sm"
                      className="w-full gap-2"
                      onClick={() => { connect(); setMobileOpen(false); }}
                    >
                      <Wallet className="h-4 w-4" />
                      Connect Wallet
                    </Button>
                  )}
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
};

export default AppHeader;
