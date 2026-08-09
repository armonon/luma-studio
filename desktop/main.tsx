import React from "react";
import { createRoot } from "react-dom/client";
import StudioPage from "../app/studio/page";
import "../app/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("Luma Studio desktop root is missing");

createRoot(root).render(
  <React.StrictMode>
    <StudioPage />
  </React.StrictMode>,
);
