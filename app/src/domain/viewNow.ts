// 지금 사용자가 보는 화면을 한 줄로 — 앱이 <데이터>/view.txt 에 적고, 참모 훅(scripts/voice-hint)이 지시마다 붙인다.
// 화면을 보며 "여기 왜 이래?" 하면 참모가 "여기"를 몰랐다(2026-10-02 사용자 "내가 보는 화면을 니가 감지하느냐")
import { tr } from '../i18n';
import { isSheet, kindOf } from './reader';

export type ViewParts = {
  /** 채팅 뷰 / 터미널 뷰 — 고른 칸 */
  mode?: string;
  /** 채팅 뷰 오른쪽에서 보고 있는 참모 탭 */
  tab?: string;
  /** 오른쪽 스페이스 화면(spaceWord) */
  space?: string;
  /** 하니터 안에서 고른 프로젝트·항목 — 스페이스가 하니터일 때만 붙인다 */
  harnitor?: string;
  /** 스페이스 위에 떠 있는 미리보기 창 */
  preview?: string;
  /** 터미널 뷰에서 커서가 있는 세션 */
  focus?: string;
};

export function viewLine(p: ViewParts): string {
  const out: string[] = [];
  if (p.mode) out.push(p.mode);
  if (p.tab) out.push(tr(`채팅 탭 ${p.tab}`, `chat tab ${p.tab}`));
  if (p.space) {
    const h = p.space === tr('하니터', 'Harnitor') && p.harnitor ? ` (${p.harnitor})` : '';
    out.push(tr(`오른쪽 스페이스: ${p.space}${h}`, `right space: ${p.space}${h}`));
  }
  if (p.preview) out.push(tr(`그 위 미리보기 창: ${p.preview}`, `preview on top: ${p.preview}`));
  if (p.focus) out.push(tr(`커서가 있는 세션 ${p.focus}`, `focused session ${p.focus}`));
  return out.join(' · ');
}

const tilde = (p: string, home: string) => (home && (p === home || p.startsWith(`${home}/`)) ? `~${p.slice(home.length)}` : p);
const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() ?? p;

/** 미리보기 창·탭에 뜬 파일 경로를 말로(~ 로 줄임) */
export const pathWord = (p: string, home: string) => tilde(p, home);

/** 가운데 탭(d:)에 뜬 파일 종류 — 보관함 탭은 md·엑셀만이 아니라 그림·영상·html·pdf 도 연다(2026-10-11) */
function fileWord(p: string): string {
  if (isSheet(p)) return tr('엑셀', 'spreadsheet');
  switch (kindOf(p)) {
    case 'md': case 'text': return tr('문서', 'document');
    case 'image': return tr('그림', 'image');
    case 'video': return tr('영상', 'video');
    case 'html': return tr('html 시안', 'html draft');
    case 'pdf': return 'PDF';
    default: return tr('파일', 'file');
  }
}

/** 스페이스 화면 키(o:·p:·s:·d:·c:·h:·m:·rv:·rp:·r:·t:·l:)를 말로 */
export function spaceWord(key: string, n: { orch: (id: string) => string | undefined; session: (id: string) => string | undefined; home: string }): string {
  const [k, rest] = [key.slice(0, key.indexOf(':') + 1), key.slice(key.indexOf(':') + 1)];
  switch (k) {
    case 'o:': return tr(`${n.orch(rest) ?? rest} 대시보드`, `${n.orch(rest) ?? rest} dashboard`);
    case 'p:': return tr(`프로젝트 ${base(rest)} 대시보드`, `project ${base(rest)} dashboard`);
    case 's:': return tr(`세션 ${n.session(rest) ?? rest} 화면`, `session ${n.session(rest) ?? rest}`);
    case 'd:': return `${fileWord(rest)} ${tilde(rest, n.home)}`;
    case 'c:': return tr(`시안 검토(큐레이션) ${tilde(rest, n.home)}`, `design review (curation) ${tilde(rest, n.home)}`);
    case 'h:': return tr('하니터', 'Harnitor');
    case 'f:': return tr('사무실', 'office');
    case 'oh:': return tr('참모 홈', 'assistants home');
    case 'rp:': return tr('하루 리플레이', 'day replay');
    case 'rv:': return rest ? tr(`리뷰 ${rest}`, `review ${rest}`) : tr('리뷰', 'review');
    case 'r:': return tr(`예약(루틴) ${rest}`, `scheduled (routine) ${rest}`);
    case 't:': return rest ? tr(`도구 ${base(rest)}`, `tools ${base(rest)}`) : tr('도구', 'tools');
    case 'l:': {
      // 보관함 — l:<참모 id>#<폴더 열쇠>(u:내 폴더·p:프로젝트·etc)
      const [id, f] = [rest.split('#')[0] ?? rest, rest.split('#')[1] ?? ''];
      const folder = f === 'etc' ? tr(' 기타', ' other') : f.startsWith('p:') ? ` ${base(f.slice(2))}` : f ? ` ${f.slice(2)}` : '';
      return tr(`${n.orch(id) ?? id} 보관함${folder}`, `${n.orch(id) ?? id} locker${folder}`);
    }
    default: return key;
  }
}

/** 터미널 뷰 왼쪽 메뉴에서 고른 칸(ui/Sidebar Selection)을 말로 */
export function selectionWord(s: { kind: string; name?: string; key?: string; id?: string }): string {
  switch (s.kind) {
    case 'orchestrator': return tr('참모', 'assistant');
    case 'orchHome': return tr('참모 홈', 'assistants home');
    case 'all': return tr('전체 보기', 'all sessions');
    case 'project': return tr(`프로젝트 ${s.name ?? ''}`, `project ${s.name ?? ''}`);
    case 'routine': return tr(`예약(루틴) ${s.name ?? ''}`, `scheduled (routine) ${s.name ?? ''}`);
    case 'review': return tr('리뷰', 'review');
    case 'helpers': return tr('도우미', 'helpers');
    case 'loose': return tr('프로젝트 밖 세션', 'sessions outside projects');
    case 'load': return tr('부하', 'load');
    case 'replay': return tr('다시 보기', 'replay');
    case 'tama': return tr('다마고치', 'pet');
    case 'external': return tr('외부 예약 세션', 'scheduled session');
    default: return s.kind;
  }
}
