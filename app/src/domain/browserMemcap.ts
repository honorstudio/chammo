// 참모 브라우저 메모리 상한(2026-11-16 맥 멈춤 사고) — 래퍼가 남긴 기록(Rust browser_memcap_events)을
// 맡긴 참모 입력칸에 [앱] 한 줄로, 스크립트 길이면 그 세션에도 한 줄. MCP 길은 세션이 도구 결과 꼬리로 이미 안다
import { tr } from '../i18n';
import type { Session } from './session';

export type MemcapEvent = {
  at: string;
  profile: string;
  action: 'trim' | 'kill';
  why: 'profile' | 'total';
  bytes: number;
  capGb: number;
  tabs: string[];
  sessionPid: number;
  via?: string;
};

const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)}GB`;
const tabsOf = (e: MemcapEvent) => (e.tabs.length ? tr(` · 탭 ${e.tabs.slice(0, 3).join(', ')}`, ` · tabs ${e.tabs.slice(0, 3).join(', ')}`) : '');
const did = (e: MemcapEvent) => (e.action === 'kill' ? tr('크롬을 껐어', 'closed its Chrome') : tr('제일 큰 탭을 닫았어', 'closed the biggest tab'));
const cap = (e: MemcapEvent) => (e.why === 'total' ? tr(`전체 상한 ${e.capGb}GB`, `total limit ${e.capGb}GB`) : tr(`프로필 상한 ${e.capGb}GB`, `profile limit ${e.capGb}GB`));

export const memcapSession = (e: MemcapEvent, sessions: Session[]) => (e.sessionPid > 0 ? sessions.find((s) => s.procPid === e.sessionPid) : undefined);

/** 참모 입력칸 한 줄(Enter 로 보내져서 줄바꿈 없이) */
export function chiefLine(e: MemcapEvent, who?: Session): string {
  const name = who ? who.name || who.project || who.id : tr('주인 모르는', 'an unknown');
  return tr(
    `[앱] 참모 브라우저 메모리 상한: '${e.profile}' 가 ${gb(e.bytes)}로 ${cap(e)}을 넘어 ${did(e)} — ${name} 세션${tabsOf(e)}. 그 세션이 큰 원본 이미지·무한 스크롤 같은 페이지를 여는지 보고 작게 나눠 열게 해 줘`,
    `[app] Assistant browser memory limit: '${e.profile}' reached ${gb(e.bytes)}, over the ${cap(e)}, so it ${did(e)} — ${name} session${tabsOf(e)}. Check whether that session opens huge images or endless pages and have it open them in smaller pieces`,
  );
}

/** 스크립트 길 세션에 보낼 한 줄 */
export function sessionLine(e: MemcapEvent): string {
  return tr(
    `[앱] 네 스크립트가 쓰던 참모 브라우저 '${e.profile}' 가 ${gb(e.bytes)}로 ${cap(e)}을 넘어 ${did(e)}${tabsOf(e)}. 큰 원본 이미지는 작은 크기로, 페이지는 나눠 열고 다시 돌려 줘`,
    `[app] The assistant browser '${e.profile}' your script used reached ${gb(e.bytes)}, over the ${cap(e)}, so it ${did(e)}${tabsOf(e)}. Use smaller images, open pages in smaller batches, and run it again`,
  );
}

/** 보낼 곳 — 참모가 없으면 [](다음 바퀴에 다시) */
export function routeMemcap(e: MemcapEvent, o: { sessions: Session[]; chiefOf: (s?: Session) => Session | undefined }): { to: string; text: string }[] {
  const s = memcapSession(e, o.sessions);
  const chief = o.chiefOf(s);
  if (!chief) return [];
  const out = [{ to: chief.id, text: chiefLine(e, s) }];
  if (s && e.via === 'script' && s.id !== chief.id) out.push({ to: s.id, text: sessionLine(e) });
  return out;
}
