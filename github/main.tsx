import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import VolatilityDashboard from "../components/VolatilityDashboard";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode><VolatilityDashboard /></StrictMode>,
);
