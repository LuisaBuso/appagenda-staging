import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import { installApiFetchInterceptor } from "./lib/fetch-interceptor.ts";
import "./index.css"; // ← ESTE ES EL QUE FALTABA
import 'react-day-picker/dist/style.css';
import './styles/datepicker.css';

document.documentElement.setAttribute("translate", "no");
document.documentElement.classList.add("notranslate");
document.body.setAttribute("translate", "no");
document.body.classList.add("notranslate");
installApiFetchInterceptor();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
