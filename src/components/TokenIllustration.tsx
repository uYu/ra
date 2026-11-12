import { useId } from "react";
import type { Kind } from "../game/types.ts";
import { Glyph } from "./Art.tsx";

// Bold silhouettes carry the image at token size; fine relief appears in details.
function Monument({ variant }: { variant: number }) {
  const stone = "#e7b766",
    shade = "#ac743c",
    light = "#ffe5a0";
  return (
    <g stroke="#80542f" strokeWidth="1.2" strokeLinejoin="round">
      <ellipse
        cx="50"
        cy="68"
        rx="35"
        ry="4"
        fill="#75502c"
        opacity=".18"
        stroke="none"
      />
      {variant === 0 && (
        <>
          <path d="M16 65v-9h8v-9h8v-9h8v-9h20v9h8v9h8v9h8v9z" fill={stone} />
          <path d="M50 29h10v9h8v9h8v9h8v9H50z" fill={shade} stroke="none" />
          <path
            d="M18 57h32M26 48h24M34 39h16M42 31h8M19 62h28"
            stroke={light}
          />
          <path d="M45 65v-9h10v9" fill="#6c4d35" />
        </>
      )}
      {variant === 1 && (
        <>
          <path d="M12 64h74v6H12z" fill={shade} />
          <path d="M20 62V49q4-11 17-11h18l9 13h14l6 11z" fill={stone} />
          <path d="m42 39-4-12 5-15h17l7 13-6 17z" fill="#c68c45" />
          <path d="m42 14 8-4 13 4-4 11H43z" fill="#2e6e74" />
          <path d="M48 19h11v16l-5 7-7-7z" fill={stone} />
          <path
            d="M51 27h2m4 0h2M54 28v5l3 1M51 36h7M28 49v13m10-14v14m25-10 5 10"
            fill="none"
          />
          <path d="M14 64h68M22 47h15M45 16v9m18-8-2 8" stroke={light} />
        </>
      )}
      {variant === 2 && (
        <>
          <path d="m11 65 37-51 40 51z" fill={stone} />
          <path d="m48 14 40 51H59z" fill={shade} />
          <path
            d="m11 65 37-51 11 51"
            fill="none"
            stroke={light}
            strokeWidth="1.8"
          />
          <path
            d="M27 43h26M21 51h34M17 59h40M33 35h18M40 27h9M64 40l9 7M68 52l11 6"
            stroke="#8b602f"
            opacity=".4"
          />
          <path d="M8 68h84" stroke={light} strokeWidth="2" />
        </>
      )}
      {variant === 3 && (
        <>
          <path d="M32 65h36v6H32z" fill={shade} />
          <path d="m40 61 3-39 7-13 7 13 3 39z" fill={stone} />
          <path d="m50 9 7 13 3 39H50z" fill={shade} />
          <path d="m43 22 7-13v52M41 61h16" fill="none" stroke={light} />
          <path
            d="M46 29h2m-2 5h2m-3 5h3m-3 5h3m-3 5h3m-3 5h3"
            stroke="#906534"
            strokeWidth="2"
          />
          <path d="M36 64h28" stroke={light} />
        </>
      )}
      {variant === 4 && (
        <>
          <path d="M29 65h43v6H29z" fill={shade} />
          <path d="M39 34h22l8 20-6 4-4-11v18H41V47l-5 11-6-4z" fill={stone} />
          <path d="M40 19q10-14 20 0l3 16H37z" fill="#276773" />
          <path d="M44 18h13v13l-6 5-7-6z" fill={stone} />
          <path
            d="M49 22h1m4 0h1M49 29h6M45 38l6 8 6-8M50 46v18m-7-13h15"
            fill="none"
          />
          <path d="M42 36v11m17-11v11M33 67h34" stroke={light} />
        </>
      )}
      {variant === 5 && (
        <>
          <path d="M15 66h70v5H15zM21 63V36h58v27z" fill={stone} />
          <path d="m17 36 33-19 34 19z" fill="#c98c42" />
          <path d="m50 17 34 19H50zM64 37h15v26H64z" fill={shade} />
          <path d="M35 63V42h28v21" fill="#795335" />
          <path d="M43 63V47h12v16" fill="#143f49" />
          <path
            d="M24 40v19m4-19v19m43-19v19M20 35h60M20 67h60"
            stroke={light}
          />
        </>
      )}
      {variant === 6 && (
        <>
          <path d="M22 67h56v4H22zM28 65V29h44v36z" fill={stone} />
          <path d="M23 29h54l-6-10H29z" fill="#c58c43" />
          <path d="M60 30h12v35H60z" fill={shade} />
          <path d="M39 65V36h22v29" fill="#2e646b" />
          <path d="M49 47v13m-6-8h12" stroke={light} strokeWidth="2" />
          <ellipse cx="49" cy="43" rx="4" ry="5" fill="none" stroke={light} />
          <path d="M29 23h42M31 32v29m4-29v29M26 68h48" stroke={light} />
          <circle cx="50" cy="14" r="5" fill="#e8b84e" />
        </>
      )}
      {variant === 7 && (
        <>
          <path d="M8 65h84v6H8zM13 25h74v8H13z" fill={stone} />
          <path d="M18 25 50 12l32 13z" fill="#ce974c" />
          <path d="M22 34h56v29H22z" fill="#775233" />
          {[22, 39, 56, 73].map((x) => (
            <g key={x}>
              <path d={`M${x} 34h7v29h-7z`} fill={stone} />
              <path d={`M${x - 2} 34h11m-10 3h9m-9 23h9`} stroke={light} />
            </g>
          ))}
          <path d="M13 28h74M11 66h78M25 22h50" stroke={light} />
          <path d="M48 35h7v28h-7" fill="#173e47" stroke="none" />
        </>
      )}
    </g>
  );
}

function Pharaoh() {
  return (
    <g stroke="#79502d" strokeWidth="1.1" strokeLinejoin="round">
      <ellipse
        cx="50"
        cy="68"
        rx="31"
        ry="4"
        fill="#79502d"
        opacity=".16"
        stroke="none"
      />
      <path d="M25 67 19 47l7-28q24-17 48 0l7 28-6 20z" fill="#176878" />
      {[25, 33, 41, 49, 57].map((y) => (
        <path key={y} d={`M24 ${y}h52`} stroke="#efbb58" strokeWidth="3.5" />
      ))}
      <path d="M33 20q17-12 34 0v26q-2 15-17 20-15-5-17-20z" fill="#efbf67" />
      <path
        d="M50 15q15 1 17 5v26q-2 15-17 20V15"
        fill="#d89642"
        opacity=".65"
        stroke="none"
      />
      <path
        d="m35 29 10-2m10 0 10 2M37 33h8m10 0h8"
        stroke="#173f49"
        strokeWidth="2.5"
      />
      <path d="m50 32-3 12 6 1M44 51q6 3 12 0M44 56h12" fill="none" />
      <path d="M47 59h6l1 12h-8z" fill="#1a6370" />
      <path d="M29 20q21-10 42 0" stroke="#ffe4a0" strokeWidth="3" />
      <path d="M48 20v-8q4-5 6 0l-2 8" fill="#e7b44f" />
      <circle cx="50" cy="10" r="2" fill="#a3422c" />
    </g>
  );
}

function Falcon({ sun }: { sun: boolean }) {
  return (
    <g stroke="#79502d" strokeWidth="1.2" strokeLinejoin="round">
      <circle
        cx="51"
        cy="25"
        r={sun ? 20 : 16}
        fill="#e9ab3e"
        stroke="#b3632e"
      />
      <circle
        cx="51"
        cy="25"
        r={sun ? 16 : 12}
        fill="#f8d775"
        stroke="#ffe8a4"
      />
      {sun &&
        Array.from({ length: 12 }, (_, i) => (
          <path
            key={i}
            d="M51 2v-3"
            transform={`rotate(${i * 30} 51 25)`}
            stroke="#f3c35b"
            strokeWidth="2"
          />
        ))}
      <path d="M23 67V47l11-13 17 7 16-7 10 13v20z" fill="#177280" />
      <path
        d="m29 49 13 6 9-5 8 5 13-6M27 56l15 7 9-5 10 5 13-7"
        fill="none"
        stroke="#dfaf55"
        strokeWidth="2"
      />
      <path d="m37 35 5-15 15 2 9 8-12 4-5 12z" fill="#fff0c3" />
      <path d="m57 24 15 7-15 4 4-6" fill="#d39642" />
      <path d="m45 25 12-1-4 9-8 4" fill="#1c5661" stroke="none" />
      <circle cx="53" cy="26" r="1.7" fill="#fff8dc" stroke="none" />
      <path d="M46 48h10v20H46z" fill="#efc26b" />
      <path d="M17 67h66M20 48v20m60-20v20" stroke="#ba8b40" strokeWidth="2" />
      <path d="M36 70h29" stroke="#ffe6aa" strokeWidth="2" />
    </g>
  );
}

function Civilization({ variant }: { variant: number }) {
  const colors = ["#b45c37", "#98703e", "#246d76", "#608455", "#376b87"];
  return (
    <g stroke="#956838" strokeWidth="1.2" strokeLinejoin="round">
      <path d="M17 69V27h66v42" fill="#e2b46b" />
      <path d="M24 30h52v35H24z" fill="#fff0c7" />
      <path
        d="M13 24h74v7H13zM16 19h68l4 5H12zM14 66h72v5H14z"
        fill="#c58b43"
      />
      <path d="M17 23h66M17 68h65M19 32v31m62-31v31" stroke="#ffe3a0" />
      <g stroke={colors[variant] ?? colors[0]} strokeWidth="1.5">
        {variant === 0 && (
          <>
            <path d="M34 36q16 12 32 0v9q0 16-16 16T34 45z" fill="#bd6a3e" />
            <path
              d="M38 34v17q12 12 24 0V34"
              fill="none"
              stroke="#f5ce7b"
              strokeWidth="3"
            />
            <path d="M42 39v16m8-15v18m8-19v16M35 34h30" stroke="#ffdf8f" />
          </>
        )}
        {variant === 1 && (
          <>
            <path d="M29 44q20-22 42 0-21 18-42 0z" fill="#e3b65f" />
            <path
              d="M31 43q19-17 38 0"
              fill="none"
              stroke="#245d66"
              strokeWidth="3"
            />
            <circle cx="50" cy="44" r="6" fill="#245d66" />
            <path
              d="M48 51v10m8-11q5 16-7 12M33 47l-4 6"
              fill="none"
              stroke="#245d66"
              strokeWidth="2"
            />
          </>
        )}
        {variant === 2 && (
          <>
            <path d="M34 34h30v27H35l-3-4z" fill="#e8ce93" />
            <path
              d="M34 34q-7-4-6 4h7m27 23q7 3 7-4H38q-9 0-5 5"
              fill="#fff0c2"
            />
            <path d="M40 40h16m-16 6h13m-13 5h8" stroke="#487983" />
            <path d="m57 52 10-23q9 9-10 23z" fill="#276774" />
          </>
        )}
        {variant === 3 && (
          <>
            <path d="M50 64V32" fill="none" strokeWidth="2" />
            {[38, 48, 58].map((y, i) => (
              <g key={y}>
                <path
                  d={`M50 ${y}q-14 0-13-12 13 2 13 12z`}
                  fill={i % 2 ? "#7c9b50" : "#bca54e"}
                />
                <path
                  d={`M50 ${y - 2}q14-1 13-12-13 2-13 12z`}
                  fill="#83a557"
                />
              </g>
            ))}
          </>
        )}
        {variant === 4 && (
          <>
            <circle cx="50" cy="46" r="16" fill="#24576e" />
            <path
              d="m50 33 3 9 9 3-9 3-3 10-3-10-9-3 9-3z"
              fill="#f7d17b"
              stroke="#e7b855"
            />
            <circle cx="39" cy="37" r="1" fill="#fff0c8" stroke="none" />
            <circle cx="61" cy="55" r="1" fill="#fff0c8" stroke="none" />
          </>
        )}
      </g>
      <path d="M24 35v25m52-25v25" stroke="#e7bf79" />
    </g>
  );
}

function River({ flood }: { flood: boolean }) {
  return (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 63q21-11 40-5t42-9v22H9z" fill="#368ea6" />
      <path d="M9 50q23-8 43-3t39-8v17q-24 10-42 5T9 69z" fill="#72b7c3" />
      <path
        d="M8 54q12-4 22 0t22 0 22 0 18-2M8 65q12-4 22 0t22 0 22 0 18-2"
        fill="none"
        stroke="#e2f1de"
        strokeWidth="2"
      />
      <path
        d="M20 51V27m0 9L12 27m8 2 8-9M33 47V18m0 12-7-10m7 5 7-12M79 46V24m0 11-8-10m8 5 7-10"
        fill="none"
        stroke="#6c8750"
        strokeWidth="2.5"
      />
      <path
        d="m12 27-4-8 8 4m12-3 5-6-1 9m-6-4-4-8 8 5m10-3 5-4-1 8m27 8-4-7 8 3m11-1 4-6-1 9"
        fill="#b7ad59"
        stroke="#7d8b4e"
      />
      {flood && (
        <>
          <path
            d="M57 14s-12 16-12 24a12 12 0 0 0 24 0c0-8-12-24-12-24z"
            fill="#338ba6"
            stroke="#276b84"
            strokeWidth="1.5"
          />
          <path
            d="M52 31q-5 9 2 13"
            fill="none"
            stroke="#c5e7e5"
            strokeWidth="2.5"
          />
        </>
      )}
    </g>
  );
}

function Gold() {
  return (
    <g stroke="#a36c26" strokeWidth="1.2" strokeLinejoin="round">
      <ellipse
        cx="50"
        cy="68"
        rx="33"
        ry="4"
        fill="#9b6928"
        opacity=".18"
        stroke="none"
      />
      {[
        [19, 45],
        [49, 45],
        [34, 27],
      ].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <path d={`M${x} ${y + 4}l12-7 18 6v15l-12 7-18-7z`} fill="#e5a838" />
          <path d={`m${x} ${y + 4} 12-7 18 6-12 8z`} fill="#ffdb76" />
          <path d={`m${x + 18} ${y + 11} 12-8v15l-12 7z`} fill="#c38727" />
          <path
            d={`m${x + 3} ${y + 6} 13 5v10m-10-18 10 3`}
            stroke="#fff0ab"
            fill="none"
          />
        </g>
      ))}
      <path
        d="M70 20v10m-5-5h10M22 28v7m-4-3h8"
        stroke="#d69a32"
        strokeWidth="2"
      />
    </g>
  );
}

export function TokenIllustration({
  kind,
  variant = 0,
}: {
  kind: Kind;
  variant?: number;
}) {
  const id = useId().replace(/:/g, "");
  const disaster = ["war", "drought", "earthquake", "funeral"].includes(kind);
  const base =
    (
      {
        war: "civilization",
        drought: "flood",
        earthquake: "monument",
        funeral: "pharaoh",
      } as Partial<Record<Kind, Kind>>
    )[kind] ?? kind;
  const river = base === "nile" || base === "flood";
  const blue = base === "monument";
  return (
    <svg
      className={`tile-art art-${kind}`}
      width="100"
      height="82"
      viewBox="0 0 100 82"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${id}-paper`} x2=".9" y2="1">
          <stop
            stopColor={
              base === "ra"
                ? "#b66536"
                : blue
                  ? "#316b76"
                  : river
                    ? "#edf5e4"
                    : "#fff7dd"
            }
          />
          <stop
            offset="1"
            stopColor={
              base === "ra"
                ? "#803b2a"
                : blue
                  ? "#153f50"
                  : river
                    ? "#b8dce0"
                    : "#f0d19b"
            }
          />
        </linearGradient>
        <linearGradient id={`${id}-rim`} x2="0" y2="1">
          <stop stopColor="#fff0b4" />
          <stop offset=".45" stopColor="#c18b42" />
          <stop offset="1" stopColor="#edcb83" />
        </linearGradient>
      </defs>
      <rect
        x="1"
        y="1"
        width="98"
        height="80"
        rx="7"
        fill={`url(#${id}-rim)`}
        stroke="#b08145"
      />
      <rect
        x="4"
        y="4"
        width="92"
        height="74"
        rx="5"
        fill={`url(#${id}-paper)`}
        stroke="#fff2cd"
      />
      <path
        d="M7 13V8h8m70 0h7v5M7 69v5h8m70 0h7v-5"
        fill="none"
        stroke={blue ? "#cdb779" : "#b98a4d"}
        strokeWidth="1"
      />
      <path d="M10 8h80M10 74h80" stroke="#fff0c0" opacity=".6" />
      <g className="token-scene" opacity={disaster ? 0.55 : 1}>
        {base === "monument" && <Monument variant={variant} />}
        {base === "pharaoh" && <Pharaoh />}
        {base === "civilization" && <Civilization variant={variant} />}
        {river && <River flood={base === "flood"} />}
        {base === "gold" && <Gold />}
        {(base === "god" || base === "ra") && <Falcon sun={base === "ra"} />}
      </g>
      {kind === "monument" && (
        <g className="monument-number">
          <rect
            x="4"
            y="4"
            width="19"
            height="20"
            rx="4"
            fill="#ffedb9"
            stroke="#be9552"
          />
          <text
            x="13.5"
            y="19"
            fill="#234d59"
            textAnchor="middle"
            fontFamily="Georgia, serif"
            fontSize="16"
            fontWeight="bold"
          >
            {variant + 1}
          </text>
        </g>
      )}
      {disaster && (
        <>
          <rect
            x="2"
            y="2"
            width="96"
            height="78"
            rx="6"
            fill="none"
            stroke="#ab4630"
            strokeWidth="3"
          />
          <path d="m12 15 75 52m0-52L12 67" stroke="#fff0c7" strokeWidth="7" />
          <path
            d="m12 15 75 52m0-52L12 67"
            stroke="#ad4932"
            strokeWidth="3.5"
          />
          <circle cx="80" cy="18" r="12" fill="#a13f2d" stroke="#efc480" />
          <g color="#fff0cc" transform="translate(70 8) scale(.31)">
            <Glyph kind={kind} />
          </g>
        </>
      )}
    </svg>
  );
}

export function SunDiskArt() {
  const id = useId().replace(/:/g, "");
  return (
    <svg className="sun-disk-art" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-coin`} cx=".35" cy=".22" r=".85">
          <stop stopColor="#fff0a3" />
          <stop offset=".5" stopColor="#ffd36a" />
          <stop offset="1" stopColor="#d7982e" />
        </radialGradient>
      </defs>
      <circle
        cx="50"
        cy="50"
        r="48"
        fill="#c9953c"
        stroke="#ffe9a1"
        strokeWidth="1"
      />
      <circle cx="50" cy="50" r="44" fill="#185a64" stroke="#8c682e" />
      {Array.from({ length: 24 }, (_, i) => (
        <path
          key={i}
          d="m48 5 2 5 2-5"
          transform={`rotate(${i * 15} 50 50)`}
          fill="#f6ca67"
        />
      ))}
      <circle
        cx="50"
        cy="50"
        r="38"
        fill={`url(#${id}-coin)`}
        stroke="#ffe99c"
        strokeWidth="1.5"
      />
      <circle
        cx="50"
        cy="50"
        r="34"
        fill="none"
        stroke="#bb812d"
        strokeWidth=".65"
      />
      <path
        d="M23 26a36 36 0 0 1 48-3"
        fill="none"
        stroke="#fff7c9"
        strokeWidth="1.8"
        opacity=".9"
      />
      <path
        d="M26 78a36 36 0 0 0 48-2"
        fill="none"
        stroke="#b97c28"
        strokeWidth="1.2"
      />
    </svg>
  );
}

export function TileBackArt({ stacked = false }: { stacked?: boolean }) {
  return (
    <svg className="tile-back-art" viewBox="0 0 100 82" aria-hidden="true">
      {stacked && (
        <>
          <rect
            x="13"
            y="2"
            width="84"
            height="66"
            rx="5"
            fill="#e5c48b"
            stroke="#ad7d40"
          />
          <rect
            x="8"
            y="7"
            width="84"
            height="66"
            rx="5"
            fill="#f7dfab"
            stroke="#ad7d40"
          />
        </>
      )}
      <rect
        x="3"
        y="12"
        width="84"
        height="66"
        rx="5"
        fill="#174f5e"
        stroke="#d8ad61"
        strokeWidth="2"
      />
      <rect
        x="7"
        y="16"
        width="76"
        height="58"
        rx="3"
        fill="none"
        stroke="#f2d28f"
      />
      <path d="m45 22 24 23-24 23-24-23z" fill="#226c77" stroke="#bda66a" />
      <circle cx="45" cy="45" r="12" fill="#e9b953" stroke="#ffe1a0" />
      <circle cx="45" cy="45" r="5" fill="#215b65" />
      <path
        d="M45 28v-3m0 40v-3M28 45h-3m40 0h-3M33 33l-2-2m28 28-2-2M33 57l-2 2m28-28-2 2"
        stroke="#ffe1a0"
        strokeWidth="1.5"
      />
      <path
        d="M11 24v-4h7m54 0h7v4M11 66v4h7m54 0h7v-4"
        stroke="#e5bf7b"
        fill="none"
      />
    </svg>
  );
}

export function LotusColumn() {
  return (
    <svg className="lotus-column" viewBox="0 0 80 105" aria-hidden="true">
      <defs>
        <linearGradient id="column-stone" x2="1" y2="0">
          <stop stopColor="#c68b42" />
          <stop offset=".4" stopColor="#f8d58d" />
          <stop offset="1" stopColor="#d29c50" />
        </linearGradient>
      </defs>
      <path d="M10 12h60l-7 12H17z" fill="#b79355" stroke="#a98247" />
      <path d="M14 15h52M19 22h42" stroke="#ecd297" strokeWidth="2" />
      <path d="M20 24h40v66H20z" fill="url(#column-stone)" stroke="#c39350" />
      <path
        d="M27 27v60m8-60v60m10-60v60m8-60v60"
        stroke="#ffe6ae"
        strokeWidth="1.2"
      />
      <path d="M19 29h42M19 35h42" stroke="#69958a" strokeWidth="2.5" />
      <ellipse
        cx="40"
        cy="50"
        rx="6"
        ry="8"
        fill="none"
        stroke="#fff0c0"
        strokeWidth="1.6"
      />
      <path
        d="M40 58v19m-5-10h10M17 90h46v5H17z"
        fill="#d5a458"
        stroke="#c39350"
      />
    </svg>
  );
}
