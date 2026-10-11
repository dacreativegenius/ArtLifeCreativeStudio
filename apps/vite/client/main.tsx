import './mercury-bridge'
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App"
import "./global.css"
import { installAppleTouchIcon, registerServiceWorker } from "./lib/art/pwa"

registerServiceWorker()
installAppleTouchIcon()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
