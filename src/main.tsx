import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";
import { EvalProvider } from "./components/EvalContext";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <EvalProvider>
    <App />
  </EvalProvider>
);