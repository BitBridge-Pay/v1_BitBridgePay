import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Outlet, useLocation } from "react-router-dom";
import { WalletProvider } from "@/hooks/useWallet";
import { PaymentsProvider } from "@/hooks/usePayments";
import AppHeader from "@/components/layout/AppHeader";
import Index from "./pages/Index";
import RequestPayment from "./pages/RequestPayment";
import PaymentDetail from "./pages/PaymentDetail";
import CustomerPay from "./pages/CustomerPay";
import PaymentHistory from "./pages/PaymentHistory";
import SettingsPage from "./pages/SettingsPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const AppLayout = () => (
  <>
    <AppHeader />
    <Outlet />
  </>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <WalletProvider>
        <PaymentsProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/pay/:paymentId" element={<CustomerPay />} />
              <Route element={<AppLayout />}>
                <Route path="/" element={<Index />} />
                <Route path="/request" element={<RequestPayment />} />
                <Route path="/payment/:id" element={<PaymentDetail />} />
                <Route path="/history" element={<PaymentHistory />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </PaymentsProvider>
      </WalletProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
