import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyMode, getStoredMode } from "./settings/theme";

// Apply the persisted theme before first paint so there is no light-mode flash.
applyMode(
  getStoredMode(),
  typeof window !== "undefined" && !!window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false,
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
