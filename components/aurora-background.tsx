// Ambient app backdrop: soft, slowly drifting color orbs over the base wash,
// finished with a faint film grain for depth. Purely decorative and fixed
// behind all content (-z-10, pointer-events-none), so it costs nothing to the
// layout and never intercepts taps.

// Fractal-noise grain, inlined as an SVG data URI (no network request).
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export function AuroraBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* brand purple — top-left */}
      <div
        className="absolute -left-[20%] -top-[15%] size-[70vh] rounded-full opacity-30 blur-[90px]"
        style={{
          background: "radial-gradient(circle at center, #7c5cff, transparent 68%)",
          animation: "hunch-float-a 20s ease-in-out infinite",
        }}
      />
      {/* warm coral — top-right */}
      <div
        className="absolute -right-[18%] top-[8%] size-[60vh] rounded-full opacity-25 blur-[90px]"
        style={{
          background: "radial-gradient(circle at center, #ff6b5e, transparent 68%)",
          animation: "hunch-float-b 26s ease-in-out infinite",
        }}
      />
      {/* cool blue — bottom */}
      <div
        className="absolute -bottom-[20%] left-[22%] size-[65vh] rounded-full opacity-20 blur-[90px]"
        style={{
          background: "radial-gradient(circle at center, #228fff, transparent 68%)",
          animation: "hunch-float-c 30s ease-in-out infinite",
        }}
      />
      {/* film grain */}
      <div
        className="absolute inset-0 opacity-[0.04] mix-blend-overlay"
        style={{ backgroundImage: GRAIN }}
      />
    </div>
  );
}
