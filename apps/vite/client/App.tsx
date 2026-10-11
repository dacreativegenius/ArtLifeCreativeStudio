import { ThemeProvider } from "next-themes"
import { BrowserRouter, Route, Routes } from "./lib/router"
import Index from "./pages/Index"
import NotFound from "./pages/NotFound"

// The production build uses a relative base ("./") so it can run from the Electron
// app:// protocol, file-like hosts and sub-folders. React Router needs an absolute
// basename, so resolve "./" against the current page instead of passing it raw
// (a raw "./" basename matches no URL and the whole app renders blank).
const ROUTER_BASENAME =
  new URL(import.meta.env.BASE_URL, window.location.href).pathname.replace(/\/+$/, "") || "/"

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <BrowserRouter basename={ROUTER_BASENAME}>
        <Routes>
          <Route path="/" element={<Index />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  )
}
