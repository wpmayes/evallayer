import logo from "../assets/logo.png";

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
      ? (progress.completedRuns / progress.totalRuns) * 100
      : 0;

  return (
    <header className="app-header">
      <div className="header-left">
        <img src={logo} alt="EvalLayer Logo" className="header-logo" />
        <div className="header-text">
          <h1 className="header-title">EvalLayer</h1>
        </div>
      </div>

      {progress && progress.totalRuns > 0 && (
        <div className="evaluation-progress-wrapper">
          <div className="evaluation-progress-text">
            {isRunning
              ? `Running Test ${progress.testCaseIndex + 1} · Run ${
                  progress.runNumber
                }`
              : "Evaluation Complete"}
            {" — "}
            {progress.completedRuns} / {progress.totalRuns}
          </div>

          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}
    </header>
  );
}