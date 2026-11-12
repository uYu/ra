import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Box, Motion, Journey } from "../game/motion.ts";
import { journeys, MOTION_TIMING } from "../game/motion.ts";
export type { Motion } from "../game/motion.ts";
import { describeMove } from "../game/presentation.ts";
import { TileArt } from "./TileArt.tsx";
import { TileBackArt } from "./TokenIllustration.tsx";

export function captureAnchors(): Record<string, Box> {
  const out: Record<string, Box> = {};
  document.querySelectorAll<HTMLElement>("[data-motion]").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width && r.height)
      out[el.dataset.motion!] = {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      };
  });
  return out;
}

export function ActionMotion({
  motion,
  paused,
  onDone,
}: {
  motion: Motion;
  paused: boolean;
  onDone: () => void;
}) {
  const [flights, setFlights] = useState<
    { trip: Journey; from: Box; to: Box }[]
  >([]);
  const root = useRef<HTMLDivElement>(null),
    animations = useRef<Animation[]>([]),
    done = useRef(onDone);
  done.current = onDone;
  useLayoutEffect(() => {
    const destinations = captureAnchors();
    const move = describeMove(motion.before, motion.action, motion.after);
    const fallback = destinations[`player-${move.winner ?? move.actor}`] ?? {
      x: 100,
      y: 100,
      width: 60,
      height: 50,
    };
    setFlights(
      journeys(motion).map((trip) => ({
        trip,
        from: motion.origins[trip.from] ?? destinations[trip.from] ?? fallback,
        to: destinations[trip.to] ?? fallback,
      })),
    );
  }, [motion]);

  useLayoutEffect(() => {
    if (!root.current) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const running: Animation[] = [],
      restore: (() => void)[] = [];
    flights.forEach((f, i) => {
      if (motion.action.type === "draw" && f.trip.tile?.kind !== "ra") {
        const piece = document.querySelector<HTMLElement>(
          `[data-motion="${f.trip.to}"] .tile-wrap`,
        );
        const face = piece?.querySelector<HTMLElement>(".tile"),
          back = piece?.querySelector<HTMLElement>(".pb-draw-back");
        if (!piece || !face || !back) return;
        const target = piece.getBoundingClientRect();
        const x = f.from.x + f.from.width / 2 - (target.x + target.width / 2),
          y = f.from.y + f.from.height / 2 - (target.y + target.height / 2);
        const visibility = piece.style.visibility;
        piece.style.visibility = "visible";
        restore.push(() => {
          piece.style.visibility = visibility;
        });
        // The actual complete piece moves directly to its real slot, without a handoff.
        running.push(
          piece.animate(
            [
              {
                transform: `translate(${x}px,${y}px) scale(${f.from.width / target.width},${f.from.height / target.height})`,
              },
              { transform: "translate(0,0) scale(1)", offset: 0.7 },
              { transform: "translate(0,0) scale(1)" },
            ],
            {
              duration: reduced ? 1 : MOTION_TIMING.draw,
              easing: "ease-in-out",
              fill: "both",
            },
          ),
        );
        const flip = {
          duration: reduced ? 1 : MOTION_TIMING.reveal,
          delay: reduced ? 0 : MOTION_TIMING.revealDelay,
          fill: "both" as const,
        };
        running.push(
          face.animate([{ opacity: 0 }, { opacity: 1 }], flip),
          back.animate([{ opacity: 1 }, { opacity: 0 }], flip),
        );
        return;
      }
      const node = root.current?.querySelector<HTMLElement>(
        `[data-flight="${i}"]`,
      );
      if (!node) return;
      const x = f.to.x + f.to.width / 2 - (f.from.x + f.from.width / 2),
        y = f.to.y + f.to.height / 2 - (f.from.y + f.from.height / 2);
      const ra = motion.action.type === "draw" && f.trip.tile?.kind === "ra";
      running.push(
        node.animate(
          [
            {
              transform: `translate(0,0) scale(${Math.min(1, f.from.width / node.offsetWidth)},${Math.min(1, f.from.height / node.offsetHeight)})`,
              opacity: 1,
            },
            {
              transform: `translate(${x}px,${y}px) scale(${Math.min(1, f.to.width / node.offsetWidth)},${Math.min(1, f.to.height / node.offsetHeight)})`,
              opacity: 0,
            },
          ],
          {
            duration: reduced
              ? 1
              : ra
                ? MOTION_TIMING.ra
                : f.trip.tile
                  ? MOTION_TIMING.tile
                  : MOTION_TIMING.sun,
            delay: reduced ? 0 : f.trip.delay,
            easing: "ease-in-out",
            fill: "both",
          },
        ),
      );
      if (ra) {
        const front = node.querySelector<HTMLElement>(".draw-front"),
          back = node.querySelector<HTMLElement>(".draw-back");
        const flip = {
          duration: reduced ? 1 : MOTION_TIMING.reveal,
          delay: reduced ? 0 : MOTION_TIMING.revealDelay,
          fill: "both" as const,
        };
        if (front && back)
          running.push(
            front.animate([{ opacity: 0 }, { opacity: 1 }], flip),
            back.animate([{ opacity: 1 }, { opacity: 0 }], flip),
          );
      }
    });
    if (motion.action.type === "draw" && motion.after.lastTile?.kind === "ra") {
      const origin = motion.origins[`ra-step-${motion.before.ra}`];
      const boat = document.querySelector<HTMLElement>(
        `.boat [data-motion="ra-step-${motion.after.ra}"]`,
      );
      if (origin && boat) {
        const target = boat.getBoundingClientRect();
        const x = origin.x + origin.width / 2 - (target.x + target.width / 2),
          y = origin.y + origin.height / 2 - (target.y + target.height / 2);
        running.push(
          boat.animate(
            [
              { transform: `translate(${x}px,${y}px)` },
              { transform: "translate(0,0)" },
            ],
            {
              duration: reduced ? 1 : MOTION_TIMING.boat,
              delay: reduced ? 0 : MOTION_TIMING.boatDelay,
              easing: "ease-in-out",
              fill: "backwards",
            },
          ),
        );
      }
    }
    animations.current = running;
    if (paused) running.forEach((a) => a.pause());
    let alive = true;
    const timer = !running.length
      ? setTimeout(
          () => done.current(),
          motion.action.type === "invoke" || reduced ? 0 : 500,
        )
      : undefined;
    if (running.length)
      void Promise.all(running.map((a) => a.finished.catch(() => {}))).then(
        () => {
          if (alive) done.current();
        },
      );
    return () => {
      alive = false;
      clearTimeout(timer);
      running.forEach((a) => a.cancel());
      restore.forEach((reset) => reset());
      animations.current = [];
    };
  }, [flights]);
  useEffect(() => {
    animations.current.forEach((a) => (paused ? a.pause() : a.play()));
  }, [paused]);
  return (
    <div className="action-motion-layer" ref={root} aria-hidden="true">
      {flights.map((f, i) => {
        if (motion.action.type === "draw" && f.trip.tile?.kind !== "ra")
          return null;
        const draw = motion.action.type === "draw",
          width = f.trip.tile ? 70 : 44,
          height = f.trip.tile ? 62 : 44;
        return (
          <div
            key={i}
            data-flight={i}
            className={`action-flight ${f.trip.tile ? "flying-tile" : "flying-sun"} ${draw ? "drawing-tile" : ""}`}
            style={{
              left: f.from.x + f.from.width / 2 - width / 2,
              top: f.from.y + f.from.height / 2 - height / 2,
              width,
              height,
            }}
          >
            {f.trip.tile ? (
              draw ? (
                <>
                  <span className="draw-back">
                    <TileBackArt />
                  </span>
                  <span className="draw-front">
                    <TileArt
                      kind={f.trip.tile.kind}
                      variant={f.trip.tile.variant}
                    />
                  </span>
                </>
              ) : (
                <TileArt
                  kind={f.trip.tile.kind}
                  variant={f.trip.tile.variant}
                />
              )
            ) : (
              <span>{f.trip.sun || "☀"}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
