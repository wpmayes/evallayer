import { type ReactNode } from "react";
import "../Global.css";

interface ThreePanelLayoutProps {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
}

export default function ThreePanelLayout({ left, center, right }: ThreePanelLayoutProps) {
  return (
    <div className="three-panel-container">
      <div className="panel left-panel">{left}</div>
      <div className="panel center-panel">{center}</div>
      <div className="panel right-panel">{right}</div>
    </div>
  );
}