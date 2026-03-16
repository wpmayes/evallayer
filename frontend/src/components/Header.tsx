import logo from "../assets/logo.png";
import type { MouseEvent } from "react";

interface HeaderProps {
  isRunning?: boolean;
  progress?: {
    testCaseIndex: number;
    runNumber: number;
    completedRuns: number;
    totalRuns: number;
  };
}

export default function Header({
  isRunning = false,
  progress,
}: HeaderProps) {
  const percent =
    progress && progress.totalRuns > 0
      ? Math.round((progress.completedRuns / progress.totalRuns) * 100)
      : 0;

  const isComplete =
    !isRunning &&
    progress &&
    progress.completedRuns > 0 &&
    progress.completedRuns === progress.totalRuns;

  const hasProgress = progress && progress.totalRuns > 0;

  const handleMouseOver = (e: MouseEvent<HTMLAnchorElement>) => {
    e.currentTarget.style.color = "#94a3b8";
  };

  const handleMouseOut = (e: MouseEvent<HTMLAnchorElement>) => {
    e.currentTarget.style.color = "#64748b";
  };

  return (
    <header className="app-header">
      <div className="header-left">
        <img src={logo} alt="EvalLayer Logo" className="header-logo" />
        <div className="header-text">
          <h1 className="header-title">EvalLayer</h1>
          <span style={{
            fontSize: "0.72rem",
            color: "#64748b",
            letterSpacing: "0.03em",
          }}>
            Structured LLM evaluation
          </span>
        </div>
      </div>

      {hasProgress && (
        <div className="evaluation-progress-wrapper">
          <div className="evaluation-progress-text">
            {isRunning ? (
              <>
                Running test {progress.testCaseIndex + 1}
                {" · "}
                Run {progress.runNumber}
                {" · "}
                <strong>{progress.completedRuns}/{progress.totalRuns}</strong>
                {" "}
                <span style={{ color: "#64748b" }}>({percent}%)</span>
              </>
            ) : isComplete ? (
              <span style={{ color: "#22c55e" }}>
                ✓ Evaluation complete — {progress.completedRuns} runs
              </span>
            ) : (
              <span style={{ color: "#64748b" }}>
                {progress.completedRuns}/{progress.totalRuns} runs
              </span>
            )}
          </div>

          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{
                width: `${percent}%`,
                transition: "width 0.3s ease",
                background: isComplete ? "#22c55e" : undefined,
              }}
            />
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <a
          href="https://github.com/wpmayes/evallayer"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: "0.72rem",
            color: "#64748b",
            textDecoration: "none",
            letterSpacing: "0.02em",
          }}
          onMouseOver={handleMouseOver}
          onMouseOut={handleMouseOut}
        >
          GitHub ↗
        </a>
      </div>
    </header>
  );
}