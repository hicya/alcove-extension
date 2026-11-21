import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { OptionsPage } from "./OptionsPage";

import "./options.scss";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <OptionsPage />
    </StrictMode>,
  );
}
