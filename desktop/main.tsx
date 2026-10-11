import React from "react";
import { createRoot } from "react-dom/client";
import StudioPage from "../app/studio/studio-client";
import "../app/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("Luma Studio desktop root is missing");

document.documentElement.dataset.lumaPlatform = "desktop";

createRoot(root).render(
  <React.StrictMode>
    <StudioPage desktop />
  </React.StrictMode>,
);
