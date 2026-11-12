// 폰 파일 받기 — 보여 준 파일을 iOS 공유 시트(파일 앱 저장·사진 저장·카톡 보내기)로, 안 되면 내려받기 링크로(2026-10-11 사용자).
// 공유는 파일을 통째로 메모리에 올려야 해서 큰 파일은 내려받기(사파리 → 파일 앱). 화면·통신 없음
import { tr } from '../i18n';

/** 공유 시트로 넘길 최대 크기 */
export const SHARE_MAX = 50 * 1024 * 1024;

/** canShareFiles = navigator.canShare({ files }) 가 이 파일을 받나 */
export const sharePlan = (size: number, canShareFiles: boolean): 'share' | 'download' => (canShareFiles && size <= SHARE_MAX ? 'share' : 'download');

/** File 형식 — 맥이 준 MIME 에서 charset 같은 꼬리를 뗀다 */
export const fileType = (mime: string) => mime.split(';')[0]!.trim() || 'application/octet-stream';

// ── 받기(11-12 사용자 "공유 버튼은 있는데 다운로드 버튼이 없다") — 공유와 따로, 받기 표 주소를 사파리 내려받기로(파일 앱 '다운로드') ──

/** 받기 표 — 맥이 준 원본 주소(/api/dl?t=…, 표가 열쇠)·크기·이름·MIME */
export type DlTicket = { url: string; size: number; name: string; mime: string };
/** 팀 파일 받기 한 번 묻기(/api/team-dl) — 맥이 중계에서 받아 푸는 중·실패·다 됨(받기 표) */
export type TeamDlStep = { state: 'going'; done: number; total: number } | { state: 'failed'; why: string } | ({ state: 'ready' } & DlTicket);

/** 팀 받기 상한 — 맥 /api/dl 이 통째로 넘기는 크기(mobile_http MAX_DOWNLOAD)와 같다. 넘으면 맥이 413 */
export const TEAM_DL_MAX = 200 * 1024 * 1024;
/** 팀 받기 다시 묻는 간격 */
export const TEAM_DL_POLL_MS = 1000;

/** 받는 중 % — 다 받은 건 ready 로 알아서 99 에서 멈춘다. 전체를 모르면 null('받는 중…') */
export const dlPct = (done: number, total: number): number | null => (total > 0 ? Math.min(99, Math.floor((done / total) * 100)) : null);

/** 맥 답 글(오류 몸통·실패 까닭) → 사람 말 */
export function dlErrorText(msg: string): string {
  if (/too large/.test(msg)) return tr('너무 커요 — 200MB 넘는 파일은 컴퓨터에서 받아 주세요', 'Too large — get files over 200MB on the computer');
  if (msg === 'not found' || msg === 'gone') return tr('파일이 없어요 — 지워졌거나 볼 수 없는 방이에요', "The file isn't there — deleted or in a chat you can't see");
  if (msg === 'not allowed' || msg === 'secret inside') return tr('폰에 내보낼 수 없는 파일이에요', "This file can't be sent to the phone");
  if (msg === 'net') return tr('연결이 끊겨 못 받았어요 — 다시 눌러 주세요', 'Lost the connection — tap again');
  if (msg === 'disk') return tr('컴퓨터 저장 공간이 모자라요', 'The computer is out of space');
  if (msg === 'stopped') return tr('받기를 멈췄어요', 'Download stopped');
  if (msg === 'other') return tr('못 받았어요', 'Download failed');
  return msg || tr('못 받았어요', 'Download failed');
}

/** 팀 파일 — 맥이 받아 푸는 동안 다시 묻고(onPct), 다 되면 받기 표. 실패면 까닭 글로 던진다. ask·nap 은 갈아 끼울 수 있게(시험) */
export async function waitTeamDl(ask: () => Promise<TeamDlStep>, onPct: (pct: number | null) => void, nap: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)), signal?: AbortSignal): Promise<DlTicket> {
  for (;;) {
    if (signal?.aborted) throw new DOMException('stopped', 'AbortError');
    const r = await ask();
    if (r.state === 'ready') return { url: r.url, size: r.size, name: r.name, mime: r.mime };
    if (r.state === 'failed') throw new Error(dlErrorText(r.why));
    onPct(dlPct(r.done, r.total));
    if (signal?.aborted) throw new DOMException('stopped', 'AbortError');
    await nap(TEAM_DL_POLL_MS);
  }
}
