import { useState, useEffect } from "react";
import { API_BASE_URL } from "../config";

interface FooterProps {
  onRunEvaluation?: () => void;
  isRunning?: boolean;
  disabled?: boolean;
}

export default function Footer({
  onRunEvaluation,
  isRunning = false,
  disabled = false,
}: FooterProps) {
  const [backendStatus, setBackendStatus] = useState<"checking" | "online" | "offline">("checking");

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/health`, {
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) {
          setBackendStatus("online");
        } else {
          setBackendStatus("offline");
        }
      } catch {
        setBackendStatus("offline");
      }
    };

    checkHealth();
  }, []);

  const statusLabel = {
    checking: "Checking...",
    online: "Backend Online",
    offline: "Backend Offline",
  }[backendStatus];

  return (
    <footer className="app-footer">
      <div className={`connection-badge ${backendStatus === "online" ? "connected" : backendStatus === "offline" ? "disconnected" : ""}`}>
        <span className="status-dot" />
        {statusLabel}
      </div>

      <button
        className="run-button"
        onClick={onRunEvaluation}
        disabled={disabled}
      >
        {isRunning ? "Running..." : "Run Evaluation"}
      </button>
    </footer>
  );
}