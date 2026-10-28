// 파일을 참모 앱(Craft)으로 열기 — 깔려 있으면 바로(scripts/craft open <앱> --native <파일>, 독 규칙대로 스페이스 칸에 뜬다),
// 안 깔렸으면 '참모 벡터를 설치하고 열까요? (n MB)' 한 번 묻고 같은 길(서랍 설치와 같은 체크섬·번들 id·공증 확인)로 설치 뒤 연다(2026-10-26 사용자).
// 묻는 창은 창마다 하나(CraftOpenAsk) — 부르는 쪽(팀 보관함·대화 파일·채팅 칩·미리보기 머리)은 openInCraft 만 부른다
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { tr } from '../../i18n';
import { craftErr, tileUnavailable, type DrawerRow } from '../../domain/craftDrawer';
import { craftFor, craftName, installAsk, openWithLabel } from '../../domain/craftOpen';
import type { DockItem } from '../../domain/craftDock';
import { Confirm } from '../OrchDialogs';
import { IconClose } from '../Icons';
import { IconButton } from '../kit/IconButton';
import './openInCraft.css';

const ASK = 'craft-open-ask';
const ERR = 'craft-open-err';

/** 못 연 까닭을 창 아래 한 줄로 — 오류를 받을 자리가 없는 부르는 쪽(채팅 칩) */
export const sayCraftErr = (e: unknown) => void window.dispatchEvent(new CustomEvent<string>(ERR, { detail: e instanceof Error ? e.message : String(e) }));
type Ask = { path: string; app: string; name: string; size: number | null };

const open = (app: string, path: string) => invoke<void>('craft_open_file', { app, path }).catch((e: unknown) => { throw new Error(craftErr(e).text); });

/** 참모 앱으로 열기 — app 을 안 주면 확장자로(domain/craftOpen). 깔린 앱이면 바로, 아니면 묻는 창을 띄우고 돌아온다 */
export async function openInCraft(path: string, app = craftFor(path)): Promise<void> {
  if (!app) throw new Error(tr('이 파일을 여는 참모 앱이 없어', 'No Chammo app opens this file'));
  const rows = await invoke<DrawerRow[]>('craft_apps', { refresh: false, fast: true }).catch((e: unknown) => { throw new Error(craftErr(e).text); });
  const r = rows.find((x) => x.app === app);
  if (r?.installed) return open(app, path);
  const no = r && tileUnavailable(r);
  if (no) throw new Error(no);
  window.dispatchEvent(new CustomEvent<Ask>(ASK, { detail: { path, app, name: craftName(app, r?.name), size: r?.dmgSize ?? null } }));
}

/** 묻는 창 + 설치하는 동안 한 줄 — App·메신저 창 맨 아래에 하나 */
export function CraftOpenAsk() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState<{ app: string; name: string; at: number } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const on = (e: Event) => {
      const a = (e as CustomEvent<Ask>).detail;
      setErr(''); setAsk(a);
      // 빠른 목록(네트워크 없이)엔 받을 크기가 없을 수 있다 — 저장소를 한 번 읽어 채운다
      if (a.size == null) void invoke<DrawerRow[]>('craft_apps', { refresh: false }).then((rows) => {
        const s = rows.find((x) => x.app === a.app)?.dmgSize;
        if (s) setAsk((cur) => (cur && cur.app === a.app ? { ...cur, size: s } : cur));
      }, () => {});
    };
    const bad = (e: Event) => setErr((e as CustomEvent<string>).detail);
    window.addEventListener(ASK, on);
    window.addEventListener(ERR, bad);
    return () => { window.removeEventListener(ASK, on); window.removeEventListener(ERR, bad); };
  }, []);
  // 설치·여는 중 — 독에 그 앱이 뜨면(칸이 열리면) 걷는다. 3분 넘으면 걷는다(서랍과 같은 한도)
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => void invoke<DockItem[]>('craft_dock').then((d) => {
      if (d.some((it) => it.app === busy.app || it.app.startsWith(`${busy.app}-`)) || Date.now() - busy.at > 180_000) setBusy(null);
    }, () => {}), 2000);
    return () => clearInterval(t);
  }, [busy]);
  const ok = () => {
    if (!ask) return;
    const a = ask;
    setAsk(null);
    setBusy({ app: a.app, name: a.name, at: Date.now() });
    void open(a.app, a.path).catch((e: unknown) => { setBusy(null); sayCraftErr(e); });
  };
  return (
    <>
      {ask && <Confirm title={installAsk(ask.name, ask.size)} body={tr('설치하면 이 파일을 바로 열어요', 'It opens this file right after installing')} ok={tr('설치하고 열기', 'Install and open')} onOk={ok} onCancel={() => setAsk(null)} />}
      {(busy || err) && <div className="co-note" role="status">{err ? `${tr('참모 앱으로 못 열었어', "Couldn't open it in the Chammo app")} — ${err}` : tr(`${busy!.name} 설치하고 여는 중`, `Installing and opening ${busy!.name}`)}
        {err && <IconButton size="s" label={tr('닫기', 'Close')} onClick={() => setErr('')}><IconClose /></IconButton>}</div>}
    </>
  );
}

/** 미리보기 머리의 '참모 ○○로 열기' — 참모 앱이 없는 형식이면 아무것도 안 그린다 */
export function CraftOpenChip({ path }: { path: string }) {
  const app = craftFor(path);
  if (!app) return null;
  return <button type="button" className="co-chip" title={tr('참모 앱에서 고치기 — 닫으면 이 파일에 저장', 'Edit in the Chammo app — saved back here on close')}
    onClick={() => void openInCraft(path, app).catch(sayCraftErr)}>{openWithLabel(craftName(app))}</button>;
}

/** 미리보기를 못 만들었을 때 한 줄 — 참모 앱이 여는 형식이면 '— 참모 벡터로 열기'를 바로 누르게. 오류 원문은 이름표로(2026-10-29 .ai) */
export function PreviewFail({ path, why }: { path: string; why?: string }) {
  const app = craftFor(path);
  return (
    <div className="rd-empty co-fail" title={why || undefined}>
      <span>{tr('미리보기를 못 만들었어', "Couldn't make a preview")}{app ? ' —' : ''}</span>
      {app && <CraftOpenChip path={path} />}
    </div>
  );
}
