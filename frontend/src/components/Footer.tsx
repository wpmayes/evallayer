interface FooterProps {
  onRunEvaluation?: () => void;
  isRunning?: boolean;
  disabled?: boolean;
  backendStatus: "checking" | "online" | "booting" | "offline";
}

export default function Footer({
  onRunEvaluation,
  isRunning = false,
  disabled = false,
  backendStatus,
}: FooterProps) {

  const statusLabel = {
    checking: "Checking...",
    online: "Backend Online",
    booting: "Backend Starting Up...",
    offline: "Backend Offline",
  }[backendStatus];

  return (
    <footer className="app-footer">
      <div className={`connection-badge ${backendStatus === "online" ? "connected" : backendStatus === "offline" ? "disconnected" : backendStatus === "booting" ? "booting" : ""}`}>
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