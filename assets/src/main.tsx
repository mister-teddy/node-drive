import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import 'antd/dist/reset.css';
import './main.css';

// Wait for DOM to be ready
window.addEventListener("DOMContentLoaded", () => {
  const rootElement = document.getElementById("root");

  if (!rootElement) {
    console.error("Root element not found");
    return;
  }

  const root = createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
