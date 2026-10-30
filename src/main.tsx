import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./i18n";
import Root from "./Root";
import AppMenuBar from "./AppMenuBar";
import "./styles/accent.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root>
      <AppMenuBar />
      <App />
    </Root>
  </React.StrictMode>,
);
