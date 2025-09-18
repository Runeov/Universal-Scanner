import React from "react";
import { createRoot } from "react-dom/client";
import App from "./ui/App.jsx";
import "./index.css"; // <-- Tailwind v4 + DaisyUI processed by Vite

createRoot(document.getElementById("root")).render(<App />);