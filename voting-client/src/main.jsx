import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import store from "./redux/store.js";
import AppRoutes from "./routes/AppRoutes.jsx";
import { initTheme } from "./services/theme.js";
import "./styles/theme.css";

// Apply the stored (or system) theme before the first paint so the app never
// flashes the wrong palette.
initTheme();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Provider store={store}>
      <AppRoutes />
    </Provider>
  </StrictMode>
);
