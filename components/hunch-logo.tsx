import * as React from "react";

// The Hunch mark: five equal options inside a dark lens. All five dots use the
// same purple so the mark reads as a group, not a winner/loser grid.
export function HunchLogo({ className, ...props }: React.ComponentProps<"svg">) {
  const dot = "#7c5cff";

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
      <circle cx="24" cy="24" r="23" fill="#14141b" />
      <circle cx="24" cy="24" r="22.25" stroke="#ffffff" strokeOpacity="0.08" strokeWidth="1.5" />
      <circle className="logo-halo" cx="24" cy="24" r="14" fill={dot} fillOpacity="0.14" />
      <circle cx="24" cy="13.5" r="4.7" fill={dot} />
      <circle cx="14.5" cy="23.5" r="4.7" fill={dot} />
      <circle cx="24" cy="24" r="4.9" fill={dot} />
      <circle cx="33.5" cy="23.5" r="4.7" fill={dot} />
      <circle cx="24" cy="34.5" r="4.7" fill={dot} />
    </svg>
  );
}
