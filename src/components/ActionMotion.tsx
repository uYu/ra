import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Box, Motion, Journey } from "../game/motion.ts";
import { journeys } from "../game/motion.ts";
export type { Motion } from "../game/motion.ts";
import { auctionNotice, describeMove } from "../game/presentation.ts";
import { TileArt } from "./TileArt.tsx";
import { Glyph } from "./Art.tsx";
export function captureAnchors(): Record<string, Box> {
  const out: Record<string, Box> = {};
  document.querySelectorAll<HTMLElement>("[data-motion]").forEach((el) => {
    const r = el.getBoundingClientRect();
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
    >([]),
    root = useRef<HTMLDivElement>(null),
    animations = useRef<Animation[]>([]),
    done = useRef(onDone);
  const notice =
    motion.action.type === "draw" || motion.action.type === "invoke"
      ? auctionNotice(
          motion.after,
          describeMove(motion.before, motion.action, motion.after),
        )
      : null;
  done.current = onDone;
  useLayoutEffect(() => {
    const destinations = captureAnchors();
    const fallback = destinations[`player-${motion.after.current}`] ?? {
      x: 100,
      y: 100,
      width: 60,
      height: 50,
    };
    const primary = describeMove(motion.before, motion.action, motion.after);
    const target =
      destinations[`player-${primary.winner ?? primary.actor}`] ?? fallback;
    setFlights(
      journeys(motion).map((trip) => ({
        trip,
        from:
          motion.origins[trip.from] ??
          destinations[trip.from] ??
          motion.origins[`player-${primary.actor}`] ??
          fallback,
        to: destinations[trip.to] ?? target,
      })),
    );
  }, [motion]);
  useLayoutEffect(() => {
    if (!root.current) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nodes = root.current.querySelectorAll<HTMLElement>(".action-flight");
    if (!nodes.length) {
      const timer = setTimeout(() => done.current(), reduced ? 0 : 500);
      return () => clearTimeout(timer);
    }
    const running = Array.from(nodes).map((node, i) => {
      const f = flights[i],
        x = f.to.x + f.to.width / 2 - (f.from.x + f.from.width / 2),
        y = f.to.y + f.to.height / 2 - (f.from.y + f.from.height / 2);
      return node.animate(
        [
          { transform: "translate(0,0) scale(.78) rotate(-5deg)", opacity: 0 },
          {
            transform: "translate(0,0) scale(1) rotate(0deg)",
            opacity: 1,
            offset: 0.12,
          },
          {
            transform: `translate(${x * 0.5}px,${y * 0.5 - 35}px) scale(1.12) rotate(3deg)`,
            opacity: 1,
            offset: 0.55,
          },
          {
            transform: `translate(${x}px,${y}px) scale(.55) rotate(0deg)`,
            opacity: 0,
          },
        ],
        {
          duration: reduced ? 1 : f.trip.tile ? 980 : 760,
          delay: reduced ? 0 : f.trip.delay,
          easing: "cubic-bezier(.25,.6,.3,1)",
          fill: "both",
        },
      );
    });
    const announcement =
      root.current.querySelector<HTMLElement>(".major-event-toast");
    if (announcement)
      running.push(
        announcement.animate(
          [
            { opacity: 0 },
            { opacity: 1, offset: 0.08 },
            { opacity: 1, offset: 0.88 },
            { opacity: 0 },
          ],
          { duration: reduced ? 1 : 2400, fill: "both" },
        ),
      );
    animations.current = running;
    if (paused) running.forEach((a) => a.pause());
    let alive = true;
    void Promise.all(running.map((a) => a.finished.catch(() => {}))).then(
      () => {
        if (alive) done.current();
      },
    );
    return () => {
      alive = false;
      running.forEach((a) => a.cancel());
      animations.current = [];
    };
  }, [flights]);
  useEffect(() => {
    animations.current.forEach((a) => (paused ? a.pause() : a.play()));
  }, [paused]);
  return (
    <div className="action-motion-layer" ref={root} aria-hidden="true">
      {notice && (
        <div className={`major-event-toast trigger-${notice.kind}`}>
          <div className="major-event-picture">
            {notice.kind === "ra" ? <TileArt kind="ra" /> : <Glyph kind="ra" />}
          </div>
          <div>
            <strong>{notice.title}</strong>
            <p>{notice.detail}</p>
          </div>
        </div>
      )}
      {flights.map((f, i) => (
        <div
          key={i}
          className={`action-flight ${f.trip.tile ? "flying-tile" : "flying-sun"}`}
          style={{
            left: f.from.x + f.from.width / 2 - (f.trip.tile ? 35 : 22),
            top: f.from.y + f.from.height / 2 - (f.trip.tile ? 31 : 22),
          }}
        >
          {f.trip.tile ? (
            <TileArt kind={f.trip.tile.kind} variant={f.trip.tile.variant} />
          ) : (
            <span>{f.trip.sun || "☀"}</span>
          )}
        </div>
      ))}
    </div>
  );
}
