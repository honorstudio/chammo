// 앱 밖 크롬을 띄운 팀 세션 — 맡긴 참모에게 한 줄(2026-10-10 사용자 "브라우저는 참모 브라우저만"). 판단은 Rust browser_foreign(프로세스 표)
import { tr } from '../i18n';
import type { Session } from './session';

export type Foreign = { sessionPid: number; pid: number; kind: 'chrome' | 'extension' };

/** 이번에 알릴 것 하나 — 세션 번호로 짝짓고, 세션·종류마다 한 번(스크립트가 다시 돌아 크롬 번호가 바뀌어도 또 안 알린다) */
export function nextForeign(found: Foreign[], subs: Session[], done: Set<string>): { sub: Session; f: Foreign; key: string } | null {
  for (const f of found) {
    const sub = subs.find((x) => x.procPid === f.sessionPid);
    if (!sub) continue;
    const key = `${sub.id}:${f.kind}`;
    if (!done.has(key)) return { sub, f, key };
  }
  return null;
}

const whereOf = (s: Session) => [s.project, s.workspace, s.name && s.name !== s.project ? s.name : null].filter(Boolean).join(' / ');

/** 참모 입력칸 한 줄(Enter 로 보내져서 줄바꿈 없이) */
export function foreignText(s: Session, kind: Foreign['kind']): string {
  const w = whereOf(s);
  return kind === 'chrome'
    ? tr(`[앱] ${w} 세션(${s.id})이 앱 밖 크롬을 직접 띄웠어 — 앱 화면에 안 보이고 프로필이 꼬여. 그 세션에 스크립트는 chammo-browser launch 로 받아 CDP 로 붙으라고 해(hq-browser 스킬), 이 프로젝트에 브라우저가 안 붙어 있으면 scripts/app browser connect <폴더> 뒤 claude respawn ${s.id}`,
         `[app] ${w} session (${s.id}) started Chrome itself, outside the app — it doesn't show in the app and corrupts profiles. Tell it scripts must get the browser from chammo-browser launch and attach over CDP (hq-browser skill); if this project has no browser attached, scripts/app browser connect <folder> then claude respawn ${s.id}`)
    : tr(`[앱] ${w} 세션(${s.id})이 크롬 확장 중계(--extension)로 사용자 크롬을 쓰고 있어 — 켤 때 받은 옛 설정이야. 이 프로젝트에 브라우저를 붙이고(scripts/app browser connect <폴더>) claude respawn ${s.id} 로 다시 켜`,
         `[app] ${w} session (${s.id}) is using the user's own Chrome through the extension relay (--extension) — an old setup it loaded at start. Attach this project's browser (scripts/app browser connect <folder>) and restart it with claude respawn ${s.id}`);
}
