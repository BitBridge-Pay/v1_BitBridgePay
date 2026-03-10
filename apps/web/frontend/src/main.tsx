import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Suppress starknetkit's missing DialogTitle/Description warnings — their
// internal wallet modal doesn't include these; nothing we can fix from outside.
const _warn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  const msg = typeof args[0] === "string" ? args[0] : "";
  if (msg.includes("DialogContent") || msg.includes("DialogTitle") || msg.includes("aria-describedby")) return;
  _warn(...args);
};

createRoot(document.getElementById("root")!).render(<App />);
