import React from "react";
import { createRoot } from "react-dom/client";
import {
  TokenIllustration,
  SunDiskArt,
} from "../../src/components/TokenIllustration.tsx";
import type { Kind } from "../../src/game/types.ts";
const monuments = [
  "阶梯塔",
  "狮身像",
  "金字塔",
  "方尖碑",
  "雕像",
  "陵墓",
  "圣祠",
  "神庙",
];
const civilizations = ["艺术", "宗教", "文字", "农业", "天文"];
const others: [Kind, string][] = [
  ["pharaoh", "法老"],
  ["god", "神祇"],
  ["ra", "太阳神"],
  ["gold", "黄金"],
  ["nile", "尼罗河"],
  ["flood", "洪水"],
  ["war", "战争"],
  ["drought", "干旱"],
  ["earthquake", "地震"],
  ["funeral", "葬礼"],
];
function Row({
  title,
  items,
}: {
  title: string;
  items: [Kind, number, string][];
}) {
  return (
    <section>
      <h2>{title}</h2>
      <div className="tiles">
        {items.map(([kind, variant, label]) => (
          <article key={`${kind}-${variant}`}>
            <TokenIllustration kind={kind} variant={variant} />
            <span>{label}</span>
          </article>
        ))}
      </div>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(
  <main>
    <header>
      <b>RA · 太阳神</b>
      <span>插画与组件校样 · 实际游戏资产</span>
    </header>
    <Row
      title="古迹 · 八种独立建筑"
      items={monuments.map((s, i) => ["monument", i, s])}
    />
    <Row
      title="文明 · 五种独立纹样"
      items={civilizations.map((s, i) => ["civilization", i, s])}
    />
    <Row title="人物、资源与灾难" items={others.map(([k, s]) => [k, 0, s])} />
    <section>
      <h2>太阳圆盘 · 青金齿边 / 黄金币面</h2>
      <div className="coins">
        {[2, 5, 8, 13].map((n) => (
          <div className="coin" key={n}>
            <SunDiskArt />
            <b>{n}</b>
          </div>
        ))}
        <div className="swatches">
          {["#104b59", "#ffd16b", "#fff0d5", "#aa4b29"].map((c) => (
            <span key={c} style={{ background: c }} />
          ))}
        </div>
      </div>
    </section>
    <style>{`*{box-sizing:border-box}body{margin:0;background:#fbecd3;color:#143f4c;font-family:'PingFang SC',sans-serif}main{width:1200px;padding:30px 38px;margin:auto}header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #cba16a;padding-bottom:20px;margin-bottom:20px}header b{font:700 28px Georgia,serif}header span{color:#82633d;font-size:14px}h2{font-size:16px;margin:18px 0 12px}.tiles{display:grid;grid-template-columns:repeat(8,1fr);gap:12px}article{border:1px solid #d4aa70;border-radius:9px;padding:9px;background:linear-gradient(130deg,#fff8e8,#f5ddb5);display:flex;align-items:center;flex-direction:column;gap:6px;box-shadow:0 2px 2px #785b2220}.tile-art{display:block;width:100%;height:88px}article span{font-size:12px}.coins{display:flex;gap:24px;align-items:center}.coin{position:relative;width:82px;height:82px;display:grid;place-items:center}.sun-disk-art{position:absolute;inset:0;width:100%;height:100%;filter:drop-shadow(0 2px 2px #785b2240)}.coin b{position:relative;z-index:1;font-size:32px;color:#103e4b;text-shadow:0 1px #fff1bb}.swatches{margin-left:auto;display:flex;gap:10px}.swatches span{width:55px;height:55px;border-radius:50%;border:1px solid #cba16a}`}</style>
  </main>,
);
