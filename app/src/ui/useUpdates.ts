// 새 버전 감지 — 켜자마자 한 번, 켜져 있는 동안 2시간마다, 창이 다시 앞에 오면(15분 한도). 최신 Claude Code(npm 레지스트리 — winget·brew 로 깐 건 그 길의 판)·Chammo(GitHub 최신 릴리스 + 업데이터의 latest.json)를 읽어 domain/updates 로 판단.
// 오프라인·요청 제한이면 조용히 넘어간다(알림이 안 뜰 뿐 앱은 그대로)
import { useEffect, useState } from 'react';
import { appUpdateCheck, appVersion, claudeSource } from '../data/tauri';
import { onShown } from './attention';
import { IS_WIN } from '../domain/reader';
import { TICK_MS, updateChecker } from '../domain/updateCheck';
import { appUpdate, claudeBehind, parseLatestApp, reachableLatest, withFeed, type ClaudeSource, type LatestApp } from '../domain/updates';

const NPM = 'https://registry.npmjs.org/@anthropic-ai/claude-code/latest';
const GH = 'https://api.github.com/repos/honorstudio/chammo/releases/latest';
const EVERY = 6 * 60 * 60 * 1000;

async function json(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

export type Updates = { claude: string | null; app: LatestApp | null; appNow: string };

export function useUpdates(claudeVersion: string | undefined, claudeBin: string | undefined): Updates {
  const [latestClaude, setLatestClaude] = useState<string>();
  const [src, setSrc] = useState<ClaudeSource | null>(null);
  const [latestApp, setLatestApp] = useState<LatestApp | null>(null);
  const [feed, setFeed] = useState<string | null>(null);
  const [appNow, setAppNow] = useState('');
  useEffect(() => {
    let alive = true;
    void appVersion().then((v) => { if (alive) setAppNow(v); }).catch(() => {});
    const check = () => {
      void json(NPM).then((d) => { const v = (d as { version?: unknown }).version; if (alive && typeof v === 'string') setLatestClaude(v); }).catch(() => {});
      void json(GH).then((d) => { if (alive) setLatestApp(parseLatestApp(d, IS_WIN)); }).catch(() => {});
      // 업데이트 버튼이 실제로 받을 곳(latest.json) — API 가 막혀도 이걸로 띠가 뜬다. 개인 앱('off')·오프라인은 조용히
      void appUpdateCheck().then((v) => { if (alive) setFeed(v); }).catch(() => {});
    };
    // 켤 때·켜져 있는 동안 몇 시간마다(벽시계)·창이 다시 앞에 올 때(독·다시 켜기·포커스) — 언제 칠지는 domain/updateCheck
    const c = updateChecker(check, Date.now);
    c.start();
    const t = window.setInterval(c.tick, TICK_MS);
    const off = onShown((v) => { if (v) c.shown(); });
    return () => { alive = false; window.clearInterval(t); off(); };
  }, []);
  // 설치 길(winget·brew 면 그 길의 최신 판) — winget 은 원본 목록을 받느라 몇십 초 걸릴 수 있다. 못 물으면 npm 기준
  useEffect(() => {
    if (!claudeBin) return;
    let alive = true;
    const check = () => void claudeSource(claudeBin).then((s) => { if (alive) setSrc(s); }).catch(() => { if (alive) setSrc({ kind: 'npm', latest: null }); });
    check();
    const t = window.setInterval(check, EVERY);
    return () => { alive = false; window.clearInterval(t); };
  }, [claudeBin]);
  return { claude: claudeVersion ? claudeBehind(claudeVersion, reachableLatest(src, latestClaude)) : null, app: appNow ? appUpdate(appNow, withFeed(latestApp, feed)) : null, appNow };
}
