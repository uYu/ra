import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Tile } from "../game/types.ts";
import { tileLabel } from "../game/data.ts";
import { TILE_GUIDE } from "../game/tile-guide.ts";
import { TileArt } from "./TileArt.tsx";
export function useTileTooltip() {
  const [hover, setHover] = useState<{
      tile: Tile;
      box: DOMRect;
      market?: DOMRect;
      context?: string;
    } | null>(null),
    id = useId();
  const show = (tile: Tile, element: HTMLElement, context?: string) =>
    setHover({
      tile,
      box: element.getBoundingClientRect(),
      market: element.closest(".pb-market")?.getBoundingClientRect(),
      context,
    });
  const hide = () => setHover(null);
  useEffect(() => {
    if (!hover) return;
    const close = () => setHover(null);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", key);
    };
  }, [hover]);
  return {
    show,
    hide,
    id,
    tooltip: hover ? (
      <TileTooltip
        id={id}
        tile={hover.tile}
        box={hover.box}
        market={hover.market}
        context={hover.context}
      />
    ) : null,
  };
}
function TileTooltip({
  id,
  tile,
  box,
  market,
  context,
}: {
  id: string;
  tile: Tile;
  box: DOMRect;
  market?: DOMRect;
  context?: string;
}) {
  const ref = useRef<HTMLDivElement>(null),
    [position, setPosition] = useState({ left: 0, top: 0 }),
    g = TILE_GUIDE[tile.kind];
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect(),
      w = innerWidth,
      h = innerHeight;
    let left = box.right + 12;
    if (left + r.width > w - 10) left = box.left - r.width - 12;
    let top = box.top;
    // Keep every auction tile visible while its rules are being read.
    if (market) {
      if (market.right + 12 + r.width <= w - 10) {
        left = market.right + 12;
      } else if (market.left - r.width - 12 >= 10) {
        left = market.left - r.width - 12;
      } else {
        left = box.left;
        top = market.bottom + 12;
        if (top + r.height > h - 10 && market.top - r.height - 12 >= 10)
          top = market.top - r.height - 12;
      }
    }
    setPosition({
      left: Math.max(10, Math.min(left, w - r.width - 10)),
      top: Math.max(10, Math.min(top, h - r.height - 10)),
    });
  }, [box, market, tile]);
  return createPortal(
    <div
      className="tile-hover-hint"
      role="tooltip"
      id={id}
      ref={ref}
      style={position}
    >
      <header>
        <TileArt kind={tile.kind} variant={tile.variant} />
        <div>
          <h3>{tileLabel(tile)}</h3>
          <b>{g.effect}</b>
        </div>
      </header>
      <div className="hint-tags">
        <span>{g.timing}</span>
        <span>{g.lifecycle}</span>
      </div>
      <div className="hint-rules">
        {g.detail
          .split(/(?<=[。；])/u)
          .filter(Boolean)
          .map((line) => (
            <p key={line}>{line}</p>
          ))}
      </div>
      {context && <div className="hint-context">{context}</div>}
      <div className="hint-example">
        <b>例子</b> {g.example}
      </div>
      <small>点击图标可展开查看</small>
    </div>,
    document.body,
  );
}
