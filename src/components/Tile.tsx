import { createContext, useContext } from "react";
import { Info } from "lucide-react";
import type { Tile as TileType } from "../game/types.ts";
import { COLOR, isDisaster, LABEL, tileName, tileLabel } from "../game/data.ts";
import { TILE_GUIDE } from "../game/tile-guide.ts";
import { useTileTooltip } from "./TileTooltip.tsx";
import { TileArt } from "./TileArt.tsx";
export const TileInfoContext = createContext<(tile: TileType) => void>(
  () => {},
);
export function Tile({
  tile,
  selected = false,
  onClick,
  disabled = false,
  small = false,
}: {
  tile: TileType;
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  small?: boolean;
}) {
  const hints = useTileTooltip();
  const inspect = useContext(TileInfoContext),
    guide = TILE_GUIDE[tile.kind],
    danger = isDisaster(tile.kind);
  return (
    <div
      className={`tile-wrap ${small ? "compact-tile" : ""}`}
      style={{ "--tile-color": COLOR[tile.kind] } as React.CSSProperties}
    >
      {hints.tooltip}
      <button
        onMouseEnter={(e) => hints.show(tile, e.currentTarget)}
        onMouseLeave={hints.hide}
        onFocus={(e) => hints.show(tile, e.currentTarget)}
        onBlur={hints.hide}
        aria-describedby={hints.id}
        className={`tile ${small ? "small" : ""} ${selected ? "selected" : ""} ${danger ? "danger" : ""} tile-${tile.kind}`}
        onClick={() => {
          hints.hide();
          if (onClick) onClick();
          else inspect(tile);
        }}
        disabled={!!onClick && disabled}
        aria-pressed={onClick ? selected : undefined}
        aria-label={
          onClick ? `选择${tileName(tile)}` : `查看${tileName(tile)}的功能`
        }
      >
        <span className="tile-type">
          {danger ? "灾难" : LABEL[tile.kind]}
          <span>
            {danger
              ? "立即生效"
              : ["monument", "pharaoh", "nile"].includes(tile.kind)
                ? "保留"
                : "本纪元"}
          </span>
        </span>
        <span className="tile-illustration">
          <TileArt kind={tile.kind} variant={tile.variant} />
        </span>
        <b>{tileLabel(tile)}</b>
        <span className="tile-effect">
          {
            (
              {
                monument: "终局成套",
                pharaoh: "最多 +5 / 最少 −2",
                nile: "需洪水 · +1",
                flood: "+1 · 激活河流",
                civilization: "集 3 种起得分",
                gold: "每块 +3",
                god: "换牌 / +2",
                ra: "推进并拍卖",
                earthquake: "弃 2 古迹",
                funeral: "弃 2 法老",
                war: "弃 2 文明",
                drought: "弃 2 河流",
              } as Record<string, string>
            )[tile.kind]
          }
        </span>
        <span className="tile-secondary">{guide.secondary}</span>
        <span className="tile-mark">{guide.timing}</span>
      </button>
      {!small && (
        <button
          className="tile-help"
          onClick={() => inspect(tile)}
          aria-label={`查看${tileName(tile)}的功能详情`}
          title="查看功能和计分示例"
        >
          <Info size={15} />
        </button>
      )}
    </div>
  );
}
