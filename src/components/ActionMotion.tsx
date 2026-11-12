import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Box, Motion, Journey } from "../game/motion.ts";
import { journeys, MOTION_TIMING } from "../game/motion.ts";
export type { Motion } from "../game/motion.ts";
import { auctionNotice, describeMove } from "../game/presentation.ts";
import { TileArt } from "./TileArt.tsx";
import { TileBackArt } from "./TokenIllustration.tsx";
import { Glyph } from "./Art.tsx";
export function captureAnchors(): Record<string, Box> {
  const out: Record<string, Box> = {};
  document.querySelectorAll<HTMLElement>("[data-motion]").forEach((el) => {
    const picture = el.matches(".pb-slot")
      ? el.querySelector<HTMLElement>(".tile-illustration")
      : null;
    const r = (picture ?? el).getBoundingClientRect();
    if (!r.width || !r.height) return;
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
      { trip: Journey; from: Box; to: Box; via?: Box }[]
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
        via: trip.via ? destinations[trip.via] : undefined,
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
      if (f.via) {
        const revealX =
          f.via.x + f.via.width / 2 - (f.from.x + f.from.width / 2);
        const revealY =
          f.via.y + f.via.height / 2 - (f.from.y + f.from.height / 2);
        const reveal = `translate(${revealX}px,${revealY}px) scale(1)`;
        const scaleX = f.from.width / node.offsetWidth;
        const scaleY = f.from.height / node.offsetHeight;
        return node.animate(
          [
            {
              transform: `translate(0,0) scale(${scaleX},${scaleY})`,
              opacity: 1,
            },
            {
              transform: `translate(0,-10px) scale(${scaleX * 1.25},${scaleY * 1.25})`,
              opacity: 1,
              offset: 0.12,
            },
            { transform: reveal, opacity: 1, offset: 0.3 },
            { transform: reveal, opacity: 1, offset: 0.65 },
            { transform: `translate(${x}px,${y}px) scale(.2)`, opacity: 0 },
          ],
          {
            duration: reduced ? 1 : MOTION_TIMING.ra,
            easing: "ease-in-out",
            fill: "both",
          },
        );
      }
      if (motion.action.type === "draw" && f.trip.tile) {
        const scaleX = f.from.width / f.to.width;
        const scaleY = f.from.height / f.to.height;
        return node.animate(
          [
            {
              transform: `translate(0,0) scale(${scaleX},${scaleY})`,
              opacity: 1,
            },
            {
              transform: `translate(0,-10px) scale(${scaleX * 1.25},${scaleY * 1.25})`,
              opacity: 1,
              offset: 0.2,
            },
            {
              transform: `translate(${x}px,${y}px) scale(1)`,
              opacity: 1,
              offset: 0.85,
            },
            { transform: `translate(${x}px,${y}px) scale(1)`, opacity: 1 },
          ],
          {
            duration: reduced ? 1 : MOTION_TIMING.draw,
            easing: "ease-in-out",
            fill: "both",
          },
        );
      }
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
          duration: reduced
            ? 1
            : f.trip.tile
              ? MOTION_TIMING.tile
              : MOTION_TIMING.sun,
          delay: reduced ? 0 : f.trip.delay,
          easing: "cubic-bezier(.25,.6,.3,1)",
          fill: "both",
        },
      );
    });
    if (motion.action.type === "draw") {
      const front = root.current.querySelector<HTMLElement>(".draw-front");
      const back = root.current.querySelector<HTMLElement>(".draw-back");
      if (front && back) {
        const timing = {
          duration: reduced ? 1 : MOTION_TIMING.reveal,
          delay: reduced ? 0 : MOTION_TIMING.revealDelay,
          fill: "both" as const,
        };
        running.push(front.animate([{ opacity: 0 }, { opacity: 1 }], timing));
        running.push(back.animate([{ opacity: 1 }, { opacity: 0 }], timing));
      }
    }
    // Move the actual boat from its previous slot while the single Ra card rests.
    if (motion.action.type === "draw" && motion.after.lastTile?.kind === "ra") {
      const origin = motion.origins[`ra-step-${motion.before.ra}`];
      const boat = document.querySelector<HTMLElement>(
        `.boat [data-motion="ra-step-${motion.after.ra}"]`,
      );
      if (origin && boat) {
        const target = boat.getBoundingClientRect();
        const x = origin.x + origin.width / 2 - (target.x + target.width / 2);
        const y = origin.y + origin.height / 2 - (target.y + target.height / 2);
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
    const announcement =
      root.current.querySelector<HTMLElement>(".major-event-toast");
    if (announcement && getComputedStyle(announcement).display !== "none")
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
      {notice && notice.kind !== "ra" && (
        <div className={`major-event-toast trigger-${notice.kind}`}>
          <div className="major-event-picture">
            <Glyph kind="ra" />
          </div>
          <div>
            <strong>{notice.title}</strong>
            <p>{notice.detail}</p>
          </div>
        </div>
      )}
      {flights.map((f, i) => {
        const draw = motion.action.type === "draw" && !!f.trip.tile;
        const width = f.trip.tile ? (draw && !f.via ? f.to.width : 70) : 44;
        const height = f.trip.tile ? (draw && !f.via ? f.to.height : 62) : 44;
        return (
          <div
            key={i}
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
