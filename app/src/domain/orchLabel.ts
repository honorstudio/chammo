import { tr } from '../i18n';

// 참모 별명 — 사용자가 무슨 일을 시킬지 생각해서 붙이는 이름(개발·디자인…). 기본 이름은 설정값(참모·참모-2)을 따른다(2026-09-30 사용자)

/** 별명 다듬기 — 비었으면 null(= 설정 이름으로 되돌림) */
export function cleanLabel(raw: string): string | null {
  const t = [...raw.replace(/\s+/g, ' ').trim()].slice(0, 24).join('');
  return t ? t : null;
}

/** 진짜 세션 이름 = "기본 이름 · 별명" — 별명이 앱(localStorage)에만 있으면 세션끼리 주고받는 메시지·claude agents 엔
 *  참모-3 만 찍혀 서로 헷갈렸다(2026-10-02 사용자). /rename 으로 진짜 이름에 싣고, 참모인지는 앞의 기본 이름으로 가른다 */
export const NICK_SEP = ' · ';

export function splitOrchName(name: string): { base: string; nick: string | undefined } {
  const i = name.indexOf(NICK_SEP);
  if (i < 0) return { base: name, nick: undefined };
  const nick = name.slice(i + NICK_SEP.length).trim();
  return { base: name.slice(0, i), nick: nick || undefined };
}

/** 세션 목록 이름을 화면에 — 별명이 있으면 별명만(참모 번호가 안 보이게), 없으면 그대로(프로젝트 세션 끝 번호는 이름의 일부) */
export function shownName(name: string): string {
  return splitOrchName(name).nick ?? name;
}

export function withNick(name: string, nick: string): string {
  const { base } = splitOrchName(name);
  const n = cleanLabel(nick);
  return n ? `${base}${NICK_SEP}${n}` : base;
}

/** 앱 별명과 진짜 이름이 다르면 바꿀 이름, 같으면 null(별명이 없으면 손대지 않는다) */
export function renameTo(name: string, label: string | undefined): string | null {
  if (!label) return null;
  const want = withNick(name, label);
  return want === name ? null : want;
}

/** 기본 이름에서 끝 번호를 뺀 이름(참모-3 → 참모, Chammo 3 → Chammo) */
const stripNum = (base: string) => base.replace(/[-\s]*\d+$/, '').trim() || base;

/** 꼬리 — 번호 대신 글자(2 → B). 숫자가 화면에 안 보이게 */
const tail = (n: number) => String.fromCharCode(65 + ((n - 1) % 26));

/**
 * 화면에 보일 참모 이름 — 별명이 있으면 별명만, 없으면 번호 뺀 기본 이름(첫 참모 = 설정 이름).
 * 진짜 세션 이름(참모-N · 별명)은 SendMessage 주소라 안에서 그대로 쓴다. 같은 이름이 둘 이상일 때만 짧은 꼬리 —
 * 프사·색으로 이미 갈리니 최소로(2026-10-02 사용자). label = 앱 별명(아직 진짜 이름에 안 실린 것), roster = 같이 보이는 참모들
 */
export function displayName(name: string, label?: string, roster: { name: string; label?: string }[] = []): string {
  const plain = (n: string, l?: string) => l ?? splitOrchName(n).nick ?? stripNum(splitOrchName(n).base);
  const me = plain(name, label);
  const clash = roster.some((r) => r.name !== name && plain(r.name, r.label).toLowerCase() === me.toLowerCase());
  if (!clash) return me;
  const num = splitOrchName(name).base.match(/(\d+)$/)?.[1];
  return num ? `${me} ${tail(Number(num))}` : me;
}

/** 새 참모 별명 검사 — 빈칸·이미 있는 이름·구분자(·)는 안 된다. 괜찮으면 null */
export function nickProblem(raw: string, existing: string[]): string | null {
  const n = cleanLabel(raw);
  if (!n) return tr('이름을 적어 줘', 'Enter a name');
  if (n.includes('·')) return tr('· 는 쓸 수 없어', '"·" is not allowed');
  if (existing.some((e) => e.trim().toLowerCase() === n.toLowerCase())) return tr('이미 있는 이름이야', 'That name is taken');
  return null;
}

/** 별명이 이상한가 — 대화 첫 문장이 섞여 들어간 것처럼(물음표·20자 넘음) */
const saneNick = (n: string | undefined) => !!n && !n.includes('?') && [...n].length <= 20;

/**
 * 살아 있는 참모 둘이 기본 이름이 같으면(참모-3 둘) 늦게 켜진 쪽을 빈 번호로 — 별명은 그대로.
 * 번호는 살아 있는·꺼진 참모 번호 중 가장 큰 것 다음(nextOrchestratorName 과 같은 셈). 별명이 이상하면
 * 앱 별명(labels — 켜기 전 기록), 없으면 물음표 앞까지(2026-10-02 사고: '참모-3 · 쇼핑몰 문의 좀 모였나? 답한 거?')
 */
export function dupRenames(live: { id: string; name: string; startedAt: number }[], taken: string[], labels: Record<string, string>): { id: string; to: string }[] {
  const groups = new Map<string, typeof live>();
  for (const s of live) {
    const b = splitOrchName(s.name).base;
    groups.set(b, [...(groups.get(b) ?? []), s]);
  }
  const all = [...live.map((s) => s.name), ...taken].map((n) => splitOrchName(n).base);
  const out: { id: string; to: string }[] = [];
  for (const [base, g] of groups) {
    if (g.length < 2) continue;
    const prefix = stripNum(base);
    const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[-\\s]*(\\d+)$`);
    let max = Math.max(1, ...all.map((b) => Number(re.exec(b)?.[1] ?? 0)));
    for (const s of [...g].sort((a, b) => a.startedAt - b.startedAt).slice(1)) {
      max += 1;
      const nick = splitOrchName(s.name).nick;
      const cut = nick?.split('?')[0]!.trim();
      const keep = saneNick(nick) ? nick : saneNick(labels[s.id]) ? labels[s.id] : cut && saneNick(cut) ? cut : undefined;
      out.push({ id: s.id, to: keep ? `${prefix}-${max}${NICK_SEP}${keep}` : `${prefix}-${max}` });
    }
  }
  return out;
}

/** 같은 번호 /rename — 보낸 뒤 이만큼 지나도 같은 번호면 다시(목록에 이름이 반영되는 시차보다 넉넉히) */
export const RENAME_RETRY_MS = 20_000;
/** 이만큼 보내도 안 되면 멈춘다 */
export const RENAME_MAX = 3;
export type RenameSent = Record<string, { at: number; n: number }>;

/**
 * dupRenames 계획 중 지금 보낼 것 — 쉬는 세션에만. 첫 턴을 도는 세션에 보낸 /rename 은 턴이 끝날 때 `-n` 이름으로
 * 되돌아갔다(2026-10-03 QA, 대화 기록 custom-title 참모-2→4→2). 보낸 뒤에도 계획에 남아 있으면(= 이름이 안 바뀜) 잠시 뒤 다시
 */
export function renamesToSend(plan: { id: string; to: string }[], idle: (id: string) => boolean, sent: RenameSent, now: number): { send: { id: string; to: string }[]; sent: RenameSent } {
  const next: RenameSent = {};
  const send: { id: string; to: string }[] = [];
  for (const r of plan) {
    const k = `${r.id}>${r.to}`;
    const was = sent[k];
    if (was) next[k] = was;
    if (!idle(r.id)) continue;
    if (was && (now - was.at < RENAME_RETRY_MS || was.n >= RENAME_MAX)) continue;
    next[k] = { at: now, n: (was?.n ?? 0) + 1 };
    send.push(r);
  }
  return { send, sent: next };
}

/** 앱 별명과 진짜 이름이 다른 참모 → 보낼 /rename — 앞 번호는 진짜 이름에서(renameTo). 쉬는 때 보내는 건 renamesToSend(첫 턴·일하는 중엔 되돌아갔다) */
export function labelRenames(orchs: { id: string; name: string }[], labels: Record<string, string>): { id: string; to: string }[] {
  return orchs.flatMap((o) => { const to = renameTo(o.name, labels[o.id]); return to ? [{ id: o.id, to }] : []; });
}
