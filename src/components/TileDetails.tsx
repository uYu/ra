import type { Tile as TileType, State } from "../game/types.ts";
import { COLOR, isDisaster, LABEL, tileLabel } from "../game/data.ts";
import { TILE_GUIDE, collectionProgress } from "../game/tile-guide.ts";
import { TileArt } from "./TileArt.tsx";
export function TileDetails({
  tile,
  state,
  player,
}: {
  tile: TileType;
  state: State | null;
  player: number;
}) {
  const guide = TILE_GUIDE[tile.kind];
  return (
    <div
      className="tile-details"
      style={{ "--tile-color": COLOR[tile.kind] } as React.CSSProperties}
    >
      <div className="detail-hero">
        <div className="detail-art">
          <TileArt kind={tile.kind} variant={tile.variant} />
        </div>
        <div>
          <span className="detail-category">
            {isDisaster(tile.kind) ? "灾难" : LABEL[tile.kind]}
          </span>
          <h3>{tileLabel(tile)}</h3>
          <b>{guide.effect}</b>
          <p>{guide.secondary}</p>
        </div>
      </div>
      <div className="detail-tags">
        <span>{guide.timing}</span>
        <span>{guide.lifecycle}</span>
      </div>
      <h3>这块牌有什么用？</h3>
      <p>{guide.detail}</p>
      <div className="detail-example">
        <b>举个例子</b>
        <p>{guide.example}</p>
      </div>
      {state && (
        <div className="detail-current">
          <b>{state.players[player].name}的当前王国</b>
          <p>
            {isDisaster(tile.kind)
              ? `已有 ${state.players[player].tiles.filter((t) => (tile.kind === "drought" ? ["nile", "flood"].includes(t.kind) : t.kind === ({ earthquake: "monument", funeral: "pharaoh", war: "civilization" } as Record<string, string>)[tile.kind])).length} 块会受影响的牌；本批新拍品也会纳入灾难处理。`
              : collectionProgress(state.players[player], tile.kind)}
          </p>
        </div>
      )}
    </div>
  );
}
