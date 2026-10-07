import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/globals.css";
import "./i18n";
import { ModelsWindow } from "./features/models/ModelsWindow";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ModelsWindow />
  </React.StrictMode>,
);
