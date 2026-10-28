import type { Kind } from "../game/types.ts";
import { Glyph } from "./Art.tsx";
// Flat component artwork, redrawn to follow the physical edition's color families.
export function TileArt({
  kind,
  variant = 0,
}: {
  kind: Kind;
  variant?: number;
}) {
  const disaster = ["war", "drought", "earthquake", "funeral"].includes(kind);
  const base = disaster
    ? (
        {
          war: "civilization",
          drought: "flood",
          earthquake: "monument",
          funeral: "pharaoh",
        } as Record<string, Kind>
      )[kind]
    : kind;
  const blue = base === "monument",
    river = base === "nile" || base === "flood";
  return (
    <svg
      className={`tile-art art-${kind}`}
      width="100"
      height="82"
      viewBox="0 0 100 82"
      aria-hidden="true"
    >
      <rect
        width="100"
        height="82"
        rx="5"
        fill={blue ? "#182850" : river ? "#b8d9e7" : "#f4e5b7"}
      />
      <path
        d="M0 5Q50-2 100 5v11H0"
        fill={
          disaster
            ? "#a62d37"
            : blue
              ? "#7c5593"
              : river
                ? "#6ca3c0"
                : "#b77c4a"
        }
      />
      <path
        d="M0 75h100v7H0z"
        fill={
          disaster
            ? "#a62d37"
            : blue
              ? "#75518c"
              : river
                ? "#678ba5"
                : "#b3905d"
        }
      />
      <path
        d="M3 3h94v76H3z"
        stroke={disaster ? "#c54843" : "#e8cd8a"}
        fill="none"
        strokeWidth="1"
      />
      <path
        d="M10 79h80M6 8h88"
        stroke="#ffe9af"
        strokeWidth="1"
        opacity=".65"
      />
      {base === "monument" && (
        <g color="#e2aa51" transform="translate(15 15) scale(1.1)">
          <svg width="64" height="64">
            <Glyph kind="monument" variant={variant} />
          </svg>
        </g>
      )}
      {base === "pharaoh" && (
        <>
          <path
            d="M10 67h79M17 39h12v27H17zM73 28h11v38H73"
            fill="#bd773c"
            opacity=".5"
          />
          <path d="M33 64V35l8-10h16l10 13-7 6-5-7v27z" fill="#247963" />
          <path d="m38 64 10-28 9 28" fill="#c78d47" />
          <path d="M42 28V18h15v12" fill="#d2a368" />
          <path d="M39 20 42 12h17l4 10-7 8-1-9z" fill="#1b6761" />
          <path d="M58 36h14v4H58M74 24v43" stroke="#2f4756" strokeWidth="2" />
          <path d="M37 65h28" stroke="#583d3d" strokeWidth="3" />
          <circle cx="54" cy="22" r="1.3" fill="#273d43" />
        </>
      )}
      {base === "civilization" && (
        <>
          <path d="M17 65V29h65v36" fill="#b47435" opacity=".45" />
          <path d="M11 29 48 17l42 12" fill="#d49a4a" />
          <rect x="28" y="22" width="44" height="43" rx="4" fill="#ece0af" />
          <g
            color={
              ["#aa4d38", "#a87233", "#3f695e", "#537542", "#2c5674"][variant]
            }
            transform="translate(29 22) scale(.65)"
          >
            <svg width="64" height="64">
              <Glyph kind="civilization" variant={variant} />
            </svg>
          </g>
          <path
            d="M24 65h55M21 66V38m59 28V38"
            stroke="#6b5d42"
            strokeWidth="2"
          />
        </>
      )}
      {river && (
        <>
          <path
            d="M5 54q10-5 20 0t20 0 20 0 20 0 15 0M5 61q10-5 20 0t20 0 20 0 20 0 15 0M5 68q10-5 20 0t20 0 20 0 20 0 15 0"
            fill="none"
            stroke="#4d849f"
            strokeWidth="2"
          />
          <path
            d="M18 57V28m0 11L9 28m9 5 9-11M33 57V24m0 12 9-11m-9 5-7-10M73 57V26m0 10-9-10m9 4 8-10"
            fill="none"
            stroke="#a28343"
            strokeWidth="2"
          />
          <path
            d="M16 27 12 21m13 4 4-8M33 24V17m39 8-4-8"
            stroke="#668d70"
            strokeWidth="3"
          />
          {base === "flood" && (
            <path
              d="M4 48q12-6 24 0t24 0 24 0 20 0v9q-12-5-24 0t-24 0-24 0-20 0z"
              fill="#6da7c2"
            />
          )}
        </>
      )}
      {base === "gold" && (
        <>
          {[
            [35, 39],
            [62, 38],
            [49, 56],
          ].map(([x, y], i) => (
            <g key={i}>
              <circle
                cx={x}
                cy={y}
                r="15"
                fill="#e9ad32"
                stroke="#a96828"
                strokeWidth="1.6"
              />
              <circle
                cx={x}
                cy={y}
                r="11"
                fill="none"
                stroke="#f5ce65"
                strokeWidth="1.4"
              />
              <path
                d={`M${x} ${y - 7}v14m-5-8h10m-8 5 6-10`}
                stroke="#b4772f"
                strokeWidth="1.4"
              />
            </g>
          ))}
        </>
      )}
      {(base === "god" || base === "ra") && (
        <>
          <circle
            cx="50"
            cy="29"
            r="15"
            fill="#da7c31"
            stroke="#a04e33"
            strokeWidth="2"
          />
          <path d="M36 66V40h28v26" fill="#257e79" />
          <path d="M43 47v18h14V47" fill="#dba449" />
          <path
            d="M40 42 45 26l12 2 7 8-12 3-5 8z"
            fill="#e5d8aa"
            stroke="#35434b"
            strokeWidth="1.5"
          />
          <path d="m55 30 11 5-10 1" fill="#a26332" />
          <circle cx="52" cy="32" r="1.8" fill="#253844" />
          <path
            d="M27 51h12m23 0h12M29 49v20m43-20v20"
            stroke="#876037"
            strokeWidth="2"
          />
        </>
      )}
      {kind === "monument" && (
        <g className="monument-number">
          <rect
            x="5"
            y="5"
            width="25"
            height="22"
            rx="3"
            fill="#f3d997"
            stroke="#b18b43"
          />
          <text
            x="17.5"
            y="22"
            textAnchor="middle"
            fontFamily="Georgia, serif"
            fontSize="19"
            fontWeight="bold"
            fill="#273e58"
          >
            {variant + 1}
          </text>
        </g>
      )}
      {disaster && (
        <>
          <path d="m9 17 79 54M91 17 12 71" stroke="#e0ad63" strokeWidth="7" />
          <path d="m9 17 79 54M91 17 12 71" stroke="#a63337" strokeWidth="4" />
          <rect
            x="3"
            y="3"
            width="94"
            height="76"
            rx="4"
            fill="none"
            stroke="#a63337"
            strokeWidth="4"
          />
          <circle cx="82" cy="21" r="10" fill="#a63337" />
          <text
            x="82"
            y="25"
            fontSize="12"
            textAnchor="middle"
            fill="#fff2cc"
            fontWeight="bold"
          >
            −2
          </text>
        </>
      )}
    </svg>
  );
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
