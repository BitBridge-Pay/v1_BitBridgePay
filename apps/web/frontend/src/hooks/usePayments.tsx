import { createContext, useContext, useState, ReactNode } from "react";
import { type PaymentRequest } from "@/lib/mockData";

interface PaymentsContextType {
  payments: PaymentRequest[];
  addPayment: (p: PaymentRequest) => void;
  getPayment: (id: string) => PaymentRequest | undefined;
}

const PaymentsContext = createContext<PaymentsContextType | null>(null);

export const PaymentsProvider = ({ children }: { children: ReactNode }) => {
  const [payments, setPayments] = useState<PaymentRequest[]>([]);

  const addPayment = (p: PaymentRequest) => {
    setPayments((prev) => [p, ...prev]);
  };

  const getPayment = (id: string) => {
    return payments.find((p) => p.id === id || p.paymentId === id);
  };

  return (
    <PaymentsContext.Provider value={{ payments, addPayment, getPayment }}>
      {children}
    </PaymentsContext.Provider>
  );
};

export const usePayments = () => {
  const ctx = useContext(PaymentsContext);
  if (!ctx) throw new Error("usePayments must be used within PaymentsProvider");
  return ctx;
};
