import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./style.css";
import "./tabletop.css";
import "./mobile.css";
import "./artwork.css";
import "./desktop.css";
import "./components/PlayerStatus.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
