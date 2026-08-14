import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, AppErrorBoundary } from "./app/App";
import "./styles/app.css";
import "./styles/robot-push.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Renderer root element is missing");
}

document.documentElement.dataset.platform = window.bordeauxAPI?.platform || "web";

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
