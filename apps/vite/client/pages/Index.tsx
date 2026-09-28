/**
 * Sandbox template splash page.
 *
 * Rendered before Mercury's agent has generated real code into the sandbox,
 * OR when the agent wrote real code but parked it at a side route (e.g.
 * `/login`) and left `/` untouched. The on-page label makes that second
 * case diagnosable — without it the skeleton looks identical to a stuck
 * load. First-prompt workflows should replace this file (see AGENTS.md
 * "Home route (`/`) is special").
 */
export default function Index() {
  const widths = [72, 92, 48, 66];
  return (
    <main
      className="relative min-h-screen flex items-center justify-center overflow-hidden px-6"
      style={{ background: "#05050a" }}
    >
      <div className="w-full max-w-md flex flex-col gap-4" aria-hidden="true">
        {widths.map((w, i) => (
          <div
            key={i}
            className="h-3 rounded-md relative overflow-hidden"
            style={{
              width: `${w}%`,
              background: "rgba(255,255,255,0.04)",
            }}
          >
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(90deg, transparent 0%, rgba(167,139,250,0.22) 50%, transparent 100%)",
                backgroundSize: "200% 100%",
                animation: `mercury-skeleton-shimmer 1.8s linear ${i * 0.15}s infinite`,
              }}
            />
          </div>
        ))}
      </div>
      <div
        className="absolute bottom-6 left-0 right-0 text-center px-6"
        style={{
          color: "rgba(255,255,255,0.35)",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          fontSize: "12px",
          letterSpacing: "0.04em",
        }}
      >
        Workspace is live — this view updates when the home page for / is ready.
      </div>
      <style>{`
        @keyframes mercury-skeleton-shimmer {
          0% { background-position: -200% 0%; }
          100% { background-position: 200% 0%; }
        }
      `}</style>
    </main>
  );
}
