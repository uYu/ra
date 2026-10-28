import {
  BookOpen,
  History,
  Home,
  Pause,
  Play,
  Settings2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Sun } from "./Art.tsx";
import "./GameNavigation.css";

export function GameNavigation({
  replay,
  paused,
  sound,
  onHome,
  onRules,
  onLog,
  onSettings,
  onPause,
  onSound,
}: {
  replay: boolean;
  paused: boolean;
  sound: boolean;
  onHome: () => void;
  onRules: () => void;
  onLog: () => void;
  onSettings: () => void;
  onPause: () => void;
  onSound: () => void;
}) {
  return (
    <nav className="game-navigation" aria-label="对局导航">
      <div className="game-navigation-brand">
        <Sun />
        <b>RA</b>
        <span>太阳神</span>
      </div>
      <div className="game-navigation-links">
        <button className="nav-home" onClick={onHome} aria-label="返回主菜单">
          <Home />
          <span>主菜单</span>
        </button>
        <button onClick={onRules}>
          <BookOpen />
          <span>游戏规则</span>
        </button>
        <button onClick={onLog}>
          <History />
          <span>对局记录</span>
        </button>
        <button onClick={onSettings}>
          <Settings2 />
          <span>游戏设置</span>
        </button>
        <div className="game-navigation-divider" />
        {!replay && (
          <button
            onClick={onPause}
            aria-pressed={paused}
            aria-label={paused ? "继续比赛" : "暂停比赛"}
          >
            {paused ? <Play /> : <Pause />}
            <span>{paused ? "继续比赛" : "暂停比赛"}</span>
          </button>
        )}
        <button
          onClick={onSound}
          aria-pressed={sound}
          aria-label={sound ? "关闭音效" : "开启音效"}
        >
          {sound ? <Volume2 /> : <VolumeX />}
          <span>音效{sound ? "开启" : "关闭"}</span>
        </button>
      </div>
      <span className="game-navigation-save">
        <i />
        自动保存
      </span>
    </nav>
  );
}
