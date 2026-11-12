import type { Kind } from "../game/types.ts";
import { TokenIllustration } from "./TokenIllustration.tsx";

export function TileArt({
  kind,
  variant = 0,
}: {
  kind: Kind;
  variant?: number;
}) {
  return <TokenIllustration kind={kind} variant={variant} />;
}

export function TempleBackdrop() {
  return (
    <svg
      className="temple-backdrop"
      viewBox="0 0 1000 250"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id="papyrus"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M0 2h6M2 0v6"
            stroke="#efd493"
            strokeWidth=".3"
            opacity=".15"
          />
        </pattern>
      </defs>
      <rect width="1000" height="250" fill="#d3ad72" />
      <rect width="1000" height="70" fill="#1d355c" />
      <path
        d="M0 72h1000M0 82h1000M0 234h1000M0 244h1000"
        stroke="#9f4c43"
        strokeWidth="6"
      />
      {Array.from({ length: 32 }, (_, i) => (
        <text key={i} x={i * 32 + 10} y="24" fontSize="16" fill="#dcb16a">
          ✶
        </text>
      ))}
      {Array.from({ length: 8 }, (_, i) => (
        <g key={i} fill="#bd8d51" stroke="#e0c487" strokeWidth="1">
          <path
            d={`M${i * 125 + 17} 93h83l-8 15H${i * 125 + 25}zM${i * 125 + 28} 108h61v121h-61z`}
          />
          <path
            d={`M${i * 125 + 38} 110v115m20-115v115m20-115v115`}
            stroke="#dfc58a"
          />
          <path
            d={`M${i * 125 + 16} 98h85M${i * 125 + 24} 121h69`}
            stroke="#739e8e"
            strokeWidth="4"
          />
        </g>
      ))}
      <rect width="1000" height="250" fill="url(#papyrus)" />
    </svg>
  );
}
