import * as React from "react";

// The Hunch mark: a dark "lens" holding four options. Three are still unknown
// (dim), one is lit purple — the hidden consensus Hunch just found. A soft halo
// pulses around the found option (frozen under prefers-reduced-motion).
export function HunchLogo({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      role="img"
      aria-label="Hunch"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
    >
      {/* the lens */}
      <circle cx="24" cy="24" r="23" fill="#14141b" />
      <circle cx="24" cy="24" r="22.25" stroke="#ffffff" strokeOpacity="0.08" strokeWidth="1.5" />
      {/* discovery halo around the found option */}
      <circle className="logo-halo" cx="31" cy="31" r="8" fill="#7c5cff" fillOpacity="0.22" />
      {/* three options still unknown… */}
      <circle cx="17" cy="17" r="4.5" fill="#ffffff" fillOpacity="0.5" />
      <circle cx="31" cy="17" r="4.5" fill="#ffffff" fillOpacity="0.5" />
      <circle cx="17" cy="31" r="4.5" fill="#ffffff" fillOpacity="0.5" />
      {/* …and the one Hunch found */}
      <circle cx="31" cy="31" r="4.9" fill="#7c5cff" />
    </svg>
  );
}
