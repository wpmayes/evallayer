interface FooterProps {
  onRunEvaluation?: () => void;
  isRunning?: boolean;
  modelConnected?: boolean;
}

export default function Footer({
  onRunEvaluation,
  isRunning = false,
  modelConnected = true,
}: FooterProps) {
  return (
    <footer className="app-footer">
      <div
        className={`connection-badge ${
          modelConnected ? "connected" : "disconnected"
        }`}
      >
        <span className="status-dot" />
        {modelConnected ? "Connected" : "Offline"}
      </div>

      <button
        className="run-button"
        onClick={onRunEvaluation}
        disabled={isRunning}
      >
        {isRunning ? "Running..." : "Run Evaluation"}
      </button>
    </footer>
  );
}