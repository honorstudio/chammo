// 새 버전 감지 — 켜자마자 한 번, 그 뒤 6시간마다. 최신 Claude Code(npm 레지스트리)·Chammo(GitHub 최신 릴리스)를 읽어 domain/updates 로 판단.
// 오프라인·요청 제한이면 조용히 넘어간다(알림이 안 뜰 뿐 앱은 그대로)
import { useEffect, useState } from 'react';
import { appVersion } from '../data/tauri';
import { IS_WIN } from '../domain/reader';
import { appUpdate, claudeBehind, parseLatestApp, type LatestApp } from '../domain/updates';

const NPM = 'https://registry.npmjs.org/@anthropic-ai/claude-code/latest';
const GH = 'https://api.github.com/repos/honorstudio/chammo/releases/latest';
const EVERY = 6 * 60 * 60 * 1000;

async function json(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

export type Updates = { claude: string | null; app: LatestApp | null; appNow: string };

export function useUpdates(claudeVersion: string | undefined): Updates {
  const [latestClaude, setLatestClaude] = useState<string>();
  const [latestApp, setLatestApp] = useState<LatestApp | null>(null);
  const [appNow, setAppNow] = useState('');
  useEffect(() => {
    let alive = true;
    void appVersion().then((v) => { if (alive) setAppNow(v); }).catch(() => {});
    const check = () => {
      void json(NPM).then((d) => { const v = (d as { version?: unknown }).version; if (alive && typeof v === 'string') setLatestClaude(v); }).catch(() => {});
      void json(GH).then((d) => { if (alive) setLatestApp(parseLatestApp(d, IS_WIN)); }).catch(() => {});
    };
    check();
    const t = window.setInterval(check, EVERY);
    return () => { alive = false; window.clearInterval(t); };
  }, []);
  return { claude: claudeVersion ? claudeBehind(claudeVersion, latestClaude) : null, app: appNow ? appUpdate(appNow, latestApp) : null, appNow };
}
