import type { Kind } from "../game/types.ts";
export function Glyph({ kind, variant = 0 }: { kind: Kind; variant?: number }) {
  const line = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.1,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" {...line}>
      {kind === "monument" && (
        <>
          {variant === 0 && (
            <>
              <path d="M8 55h48v-8H49v-8H43v-8H37V20H27v11H21v8H15v8H8z" />
              <path d="M27 20l5-9 5 9M8 59h48M22 47h20M27 39h10" />
            </>
          )}
          {variant === 1 && (
            <>
              <path d="M8 51h47v7H8zM12 51V38h24l17 13M28 38V23l8-9 10 9v17M30 26h14M33 31h8M17 44h18M35 18h4" />
              <path d="M13 39l-3-6m31 7 5 11" />
            </>
          )}
          {variant === 2 && (
            <>
              <path d="M5 54 31 11l28 43zM31 11l7 43M5 58h54M14 40h19M20 30h12M38 54l8-19" />
            </>
          )}
          {variant === 3 && (
            <>
              <path d="m27 15 5-9 5 9 5 40H22zM17 59h30M27 21h10M27 29h10M26 38h12M25 47h14M32 16v35" />
            </>
          )}
          {variant === 4 && (
            <>
              <circle cx="32" cy="15" r="7" />
              <path d="M27 22h10l7 16-6 4-1-7v17H27V35l-1 7-6-4zM30 26h4M30 36h4M32 42v10M22 53h20v6H22z" />
            </>
          )}
          {variant === 5 && (
            <>
              <path d="M10 55h44V31L32 16 10 31zM6 31l26-20 26 20M16 55V35h32v20M26 55V40h12v15M8 59h48" />
              <path d="M20 26h24M18 37v14m28-14v14" />
            </>
          )}
          {variant === 6 && (
            <>
              <path d="M14 55h36M18 55V23h28v32M14 23h36L44 12H20zM12 59h40M24 55V29h16v26" />
              <path d="M32 35v13m-5-7h10" />
              <circle cx="32" cy="9" r="3" />
            </>
          )}
          {variant === 7 && (
            <>
              <path d="M6 55h52M10 49h44M12 24h40L32 10zM9 24h46M14 27v22m12-22v22m12-22v22m12-22v22M10 29h8m4 0h8m4 0h8m4 0h8M6 59h52" />
            </>
          )}
        </>
      )}
      {kind === "pharaoh" && (
        <>
          <path d="M20 42 12 52h40l-8-10V20L33 9 20 20zM20 25l-7 27M44 25l8 27M25 29h5m7 0h3M29 37l4 2 4-2M29 45h9M27 16h12M31 9v9" />
          <path d="M26 23v17m15-17v17" />
        </>
      )}
      {(kind === "nile" || kind === "flood") && (
        <>
          <path d="M8 29q8-9 16 0t16 0 16 0M8 39q8-9 16 0t16 0 16 0M8 49q8-9 16 0t16 0 16 0" />
          {kind === "flood" ? (
            <path d="M32 6s-9 12-9 17a9 9 0 0 0 18 0c0-5-9-17-9-17z" />
          ) : (
            <>
              <path d="M32 27V10m0 9L21 9m11 10L43 9M27 12 23 6m14 6 4-6" />
            </>
          )}
        </>
      )}
      {kind === "gold" && (
        <>
          <path d="m11 37 6-15h30l7 15-7 15H18zM17 22l6 15h31M23 37l-5 15M25 27h15M28 44h13" />
          <path d="M32 5v7M12 12l5 5m35-5-5 5" />
        </>
      )}
      {kind === "god" && (
        <>
          <path d="M32 27v30m-12-17h24M22 56l10-12 10 12" />
          <ellipse cx="32" cy="17" rx="10" ry="12" />
          <path d="M8 32q12-12 24 0 12-12 24 0M9 32l10 5m36-5-10 5" />
        </>
      )}
      {kind === "civilization" &&
        (variant === 0 ? (
          <>
            <path d="M13 47c-6-19 4-34 20-34 19 0 27 24 12 24h-7c-8 0 0 16-10 16-7 0-11-2-15-6z" />
            <circle cx="24" cy="24" r="2" />
            <circle cx="36" cy="21" r="2" />
            <circle cx="45" cy="28" r="2" />
            <circle cx="20" cy="37" r="2" />
          </>
        ) : variant === 1 ? (
          <>
            <path d="M10 52h44M14 47h36M18 47V25m28 22V25M12 25h40L32 9zM26 47V25m12 22V25" />
          </>
        ) : variant === 2 ? (
          <>
            <path d="M14 14h36v40H14zM21 23h20M21 30h17M21 37h20M21 44h12M44 8l-8 31" />
          </>
        ) : variant === 3 ? (
          <>
            <path d="M32 57V10M32 25c-14 0-14-12-14-12 14 0 14 12 14 12zm0 12c14 0 14-12 14-12-14 0-14 12-14 12zm0 12c-14 0-14-12-14-12 14 0 14 12 14 12zM32 19c14 0 14-12 14-12-14 0-14 12-14 12z" />
          </>
        ) : (
          <>
            <circle cx="32" cy="32" r="17" />
            <path d="M32 6v9m0 34v9M6 32h9m34 0h9M13 13l7 7m24 24 7 7M13 51l7-7m24-24 7-7M32 21v13l9 7" />
          </>
        ))}
      {kind === "ra" && (
        <>
          <circle cx="32" cy="28" r="13" />
          <circle cx="32" cy="28" r="5" />
          {Array.from({ length: 12 }, (_, i) => (
            <path key={i} transform={`rotate(${i * 30} 32 28)`} d="M32 6V1" />
          ))}
          <path d="M12 48q20 20 40 0M19 49v7m26-7v7M9 48h46" />
        </>
      )}
      {kind === "earthquake" && (
        <>
          <path d="M7 53h19l7-10-7-9 9-11-4-14M37 53h20M12 46V26h13M42 18h9v28h-8M11 26l15-12m15 0 13 12" />
        </>
      )}
      {kind === "funeral" && (
        <>
          <path d="M21 14q11-12 22 0l5 36q-16 13-32 0zM24 24l16 15M40 24 24 39M24 46h16M27 52h10" />
          <circle cx="32" cy="18" r="5" />
        </>
      )}
      {kind === "war" && (
        <>
          <path d="m13 11 29 29-5 5L8 16zM51 11 22 40l5 5 29-29zM33 46l14-14M17 32l14 14M42 42l10 10m-5 0 5-5M22 42 12 52m0-5 5 5" />
        </>
      )}
      {kind === "drought" && (
        <>
          <circle cx="44" cy="17" r="7" />
          <path d="M44 4V1m0 31v-3m13-12h5M31 17h-5M34 7l-3-3m23 3 3-3M7 48h50M25 33l-7 12 10 8-5 8M45 39l-7 9 7 7-2 6M6 38q8-7 16-2" />
        </>
      )}
    </svg>
  );
}
export function Sun({ className = "" }: { className?: string }) {
  return (
    <span className={`sun-emblem ${className}`}>
      <Glyph kind="ra" />
    </span>
  );
}
export function Landscape() {
  return (
    <svg
      className="landscape"
      viewBox="0 0 820 600"
      role="img"
      aria-label="日轮照耀尼罗河畔的金字塔与神庙"
    >
      <defs>
        <linearGradient id="sky" x2="0" y2="1">
          <stop stopColor="#efe5cc" />
          <stop offset="1" stopColor="#faf5e8" />
        </linearGradient>
        <linearGradient id="sand" x2="1" y2="1">
          <stop stopColor="#dac5a0" />
          <stop offset="1" stopColor="#bc9664" />
        </linearGradient>
        <pattern id="lines" width="9" height="9" patternUnits="userSpaceOnUse">
          <path d="M0 9 9 0" stroke="#f8eed8" strokeWidth=".5" opacity=".28" />
        </pattern>
      </defs>
      <path fill="url(#sky)" d="M0 0h820v600H0z" />
      <circle cx="449" cy="187" r="98" fill="#d4a34e" />
      <circle
        cx="449"
        cy="187"
        r="116"
        fill="none"
        stroke="#d4a34e"
        strokeWidth="1"
        opacity=".4"
      />
      {Array.from({ length: 24 }, (_, i) => (
        <path
          key={i}
          d="M449 53v-10"
          transform={`rotate(${i * 15} 449 187)`}
          stroke="#c9a668"
          opacity=".5"
        />
      ))}
      <path d="m170 379 193-242 162 242z" fill="#d5ba88" />
      <path d="m363 137 162 242H398z" fill="#b38a55" />
      <path d="m170 379 193-242 35 242z" fill="url(#lines)" />
      <path d="m385 405 145-189 150 189z" fill="#e3c99a" />
      <path d="m530 216 150 189H548z" fill="#c19b67" />
      <path d="M0 396q142-54 299 2t314 1 207-9v210H0z" fill="url(#sand)" />
      <path d="M0 470q220-35 389 12t431-4v122H0z" fill="#a9babb" />
      <path
        d="M0 494q220-35 389 12t431-4M0 517q220-35 389 12t431-4M0 540q220-35 389 12t431-4"
        stroke="#e5e8d9"
        fill="none"
        opacity=".65"
      />
      <path d="M0 564q256-41 463 1t357-13v48H0z" fill="#d6c39d" />
      <g fill="#2b4f51">
        <path d="M77 431h123v8H77zM82 366h113v11H82zM92 352h91l12 14H82z" />
        {[92, 120, 148, 176].map((x) => (
          <g key={x}>
            <path d={`M${x} 377h11v54h-11zM${x - 3} 377h17v5h-17z`} />
          </g>
        ))}
        <path d="m713 440-7-180 7-15 7 15 6 180zM698 444h38v8h-38" />
        <path d="M57 442q-7-46 2-98l4 1q-5 51 3 97zM61 350q-36-42-53-9 23-12 53 9M61 350q23-48 46-22-27-6-46 22M61 350q-10-47-30-42 13 15 30 42M61 350q15-34 34-30-21 9-34 30" />
        <path d="m571 498 63-3-12 13h-37zM607 495v-59l-30 48h30" />
      </g>
      <path d="M0 584h820" stroke="#b49970" />
    </svg>
  );
}
