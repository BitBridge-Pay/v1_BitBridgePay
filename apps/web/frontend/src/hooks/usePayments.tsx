import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { type PaymentRequest } from "@/lib/mockData";

const STORAGE_KEY = "bitbridge_payments";

function loadFromStorage(): PaymentRequest[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as Array<Record<string, unknown>>).map((p) => ({
      ...p,
      createdAt: new Date(p.createdAt as string),
      settledAt: p.settledAt ? new Date(p.settledAt as string) : undefined,
    })) as PaymentRequest[];
  } catch {
    return [];
  }
}

interface PaymentsContextType {
  payments: PaymentRequest[];
  addPayment: (p: PaymentRequest) => void;
  getPayment: (id: string) => PaymentRequest | undefined;
  updatePayment: (id: string, updates: Partial<PaymentRequest>) => void;
}

const PaymentsContext = createContext<PaymentsContextType | null>(null);

export const PaymentsProvider = ({ children }: { children: ReactNode }) => {
  const [payments, setPayments] = useState<PaymentRequest[]>(loadFromStorage);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payments));
  }, [payments]);

  const addPayment = (p: PaymentRequest) =>
    setPayments((prev) => [p, ...prev]);

  const getPayment = (id: string) =>
    payments.find((p) => p.id === id || p.paymentId === id);

  const updatePayment = (id: string, updates: Partial<PaymentRequest>) =>
    setPayments((prev) =>
      prev.map((p) => (p.id === id || p.paymentId === id ? { ...p, ...updates } : p))
    );

  return (
    <PaymentsContext.Provider value={{ payments, addPayment, getPayment, updatePayment }}>
      {children}
    </PaymentsContext.Provider>
  );
};

export const usePayments = () => {
  const ctx = useContext(PaymentsContext);
  if (!ctx) throw new Error("usePayments must be used within PaymentsProvider");
  return ctx;
};
