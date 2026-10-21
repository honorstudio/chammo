// 폰(모바일 웹)용 데이터 계층 — tauri.ts 의 invoke 대신 맥 앱 모바일 서버(/api, mobile_http.rs)를 부른다.
// 이름·모양은 tauri.ts 와 같게 둬서 domain/* 을 그대로 쓴다.
// 인증 = 이 기기 토큰을 localStorage 에 두고 Authorization: Bearer 로만(쿠키는 포트를 안 가려 같은 호스트 다른 포트 서버로 샌다 — 2026-10-02 재검토).
// localStorage 는 출처(스킴+호스트+포트)마다 따로라 다른 포트·홈 화면 앱과 안 섞인다
import { makeApi } from './peerApi';
import { makeTagTail, parseTagChunk } from '../domain/tagTail';
export type { MobileEnv } from './peerApi';

/** 열쇠가 없거나 바뀌었다 — 맥 앱 설정의 QR(열쇠 든 주소)로 다시 열어야 한다 */
export class NoKeyError extends Error {
  constructor() {
    super('no key');
  }
}

const TOKEN_KEY = 'chammo.token';
const getToken = (): string | null => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const setToken = (t: string | null) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* 개인 정보 보호 모드 — 저장 못 하면 매번 짝짓기 */ } };

export const hasToken = () => !!getToken();

/** 홈 화면 앱이 시작 주소의 코드를 내서 맥이 거절했나(domain/mobileAuth bootPair·spentBy) — 시작 주소는 켤 때마다 같아서 */
const HOME_TRIED_KEY = 'chammo.homeTried';
export const homeTried = (): string | null => { try { return localStorage.getItem(HOME_TRIED_KEY); } catch { return null; } };
export const markHomeTried = (code: string) => { try { localStorage.setItem(HOME_TRIED_KEY, code); } catch { /* 저장이 막히면 pair 가 먼저 알린다 */ } };

/** 이 브라우저가 localStorage 에 쓸 수 있나 — 개인 정보 보호 모드·막힌 저장소면 false */
function storageWorks(): boolean {
  try {
    const k = `${TOKEN_KEY}.probe`;
    localStorage.setItem(k, '1');
    const ok = localStorage.getItem(k) === '1';
    localStorage.removeItem(k);
    return ok;
  } catch {
    return false;
  }
}

const NO_STORAGE = '이 브라우저가 저장을 막아요(개인 정보 보호 모드?) — 일반 창에서 QR 을 다시 열어 주세요. 이 QR 은 아직 안 썼어요';

/** 짝짓기 — QR 의 일회용 코드를 내고 이 기기 토큰을 받아 저장한다(쿠키 없음).
 *  저장이 막힌 브라우저면 코드를 내기 **전에** 알린다 — 내고 나서 못 저장하면 한 번짜리 코드만 닳는다.
 *  이 저장 공간에 옛 열쇠가 남아 있으면 같이 낸다 — 맥이 새 줄 대신 그 줄의 열쇠를 바꿔 끼운다(같은 폰이 줄줄이 안 쌓이게, 2026-10-05) */
export async function pair(code: string, home = false): Promise<void> {
  if (!storageWorks()) throw new Error(NO_STORAGE);
  const prev = getToken();
  const body = { code, ...(home ? { home } : {}), ...(prev ? { prev } : {}) };
  const r = await fetch('/api/pair', { method: 'POST', credentials: 'omit', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
  const { token } = (await r.json()) as { token: string };
  setToken(token);
  if (getToken() !== token) throw new Error(NO_STORAGE.replace(' 이 QR 은 아직 안 썼어요', ' 새 QR 이 필요해요'));
}

async function call(path: string, init?: RequestInit, retried = false): Promise<Response> {
  const token = getToken();
  if (!token) throw new NoKeyError();
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const r = await fetch(path, { credentials: 'omit', cache: 'no-store', ...init, headers });
  if (r.status === 401) {
    // 그사이 다른 탭이 다시 짝지어 열쇠를 바꿔 끼웠으면(옛 열쇠는 맥이 바로 죽인다) 새 열쇠는 지우지 말고 한 번 더
    const now = getToken();
    if (now && now !== token && !retried) return call(path, init, true);
    if (now === token) setToken(null); // 끊긴 기기 — 새 QR 로 다시
    throw new NoKeyError();
  }
  if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
  return r;
}

/** 글·JSON 받기 시간 제한 — 매달린 요청 하나가 받기 고리를 통째로 세웠다(2026-10-04, 백그라운드에서 돌아온 폰). signal = 부른 쪽이 끊을 때 */
const READ_LIMIT_MS = 20_000;
async function timed<T>(path: string, signal: AbortSignal | undefined, body: (r: Response) => Promise<T>): Promise<T> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), READ_LIMIT_MS);
  const stop = () => c.abort();
  signal?.addEventListener('abort', stop);
  try {
    return await body(await call(path, { signal: c.signal }));
  } finally {
    clearTimeout(t);
    signal?.removeEventListener('abort', stop);
  }
}
const getText = (path: string, signal?: AbortSignal) => timed(path, signal, (r) => r.text());
const getJson = <T>(path: string, signal?: AbortSignal) => timed(path, signal, (r) => r.json() as Promise<T>);
/** 쓰기는 JSON 으로만 — 서버가 같은 출처 + application/json 이 아니면 거절한다(CSRF) */
const post = <T>(path: string, body: object) =>
  call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<T>);

/** 보기·채팅·대기함 길 — 다른 기기 참모(data/remote)와 같은 판을 fetch 로 */
const api = makeApi({ text: getText, json: getJson, post, bytes: (path) => call(path).then((r) => r.arrayBuffer()) });
export const {
  getEnv, readTranscript, readTranscriptBefore, readTasksSince, routinesList, readUsage, readLoad, readDirect, directAnswer, taskAnswer,
  sendTextToSession, sendStatus, interruptSession, listStoppedOrchs, readTails, listBrowsers, browserFrame, readPins, readOrder, readRoles,
} = api;
/** `claude agents --json` 원문(+컨텍스트) — 3초마다 받는다. 안 바뀌었으면 맥이 글 없이 꼬리표만 준다(domain/tagTail).
 *  다른 기기 참모(remote)는 판이 다를 수 있어 since 없이 그대로(peerApi) — 폰은 화면과 서버가 늘 같은 판 */
export const listSessionsRaw = makeTagTail((since, signal) => getText(`/api/sessions?since=${encodeURIComponent(since)}`, signal).then(parseTagChunk));

/** 계정 칸 — 이름·요금제·사용량·쉬는 때만(맥이 이메일·토큰을 안 낸다). 읽기는 domain/phoneAccounts readPhoneAccounts */
/** 짝지은 다른 기기의 카드(ADR 0011) — 이 맥이 거쳐 읽고, 누른 답은 이 맥이 사람 길로 그 기기에 넘긴다 */
export const readPeerCards = () => getJson<import('../domain/remoteCards').PeerCardsRow[]>('/api/peer-cards');
export const peerCardAnswer = (dev: string) => (id: string, pick: unknown) => post<{ ok: true }>('/api/peer-card-answer', { dev, id, pick }).then(() => undefined);
export const readAccounts = (signal?: AbortSignal) => getText('/api/accounts', signal);
/** 이 계정으로 — 맥 키체인 로그인을 바꿔 끼우고 그 칸에 고정(데스크톱 '이 계정으로'와 같은 길). 답 = 바뀐 계정 칸 원문 */
export const switchAccount = (id: string) => post<unknown>('/api/account-switch', { id }).then((v) => JSON.stringify(v));
/** 자동 전환 켜기·끄기 */
export const setAccountAuto = (on: boolean) => post<unknown>('/api/account-auto', { on }).then((v) => JSON.stringify(v));
/** 로그인 풀림(login.rs) — 맥 판단 + 폰 로그인 흐름 · 시작 · 코드 한 줄 · 그만. 해석은 domain/phoneLogin */
export const readLogin = (signal?: AbortSignal) => getText('/api/login', signal);
export const loginStart = () => post<unknown>('/api/login-start', {});
export const loginCode = (code: string) => post<unknown>('/api/login-code', { code });
export const loginCancel = () => post<unknown>('/api/login-cancel', {});
/** scripts/show 기록 꼬리 — 대시보드 파일 카드(domain/dashboard dashFiles). 안 바뀌었으면 맥이 글 없이 꼬리표만 준다(domain/tagTail) */
export const readShowLog = makeTagTail((since) => getText(`/api/shows?since=${encodeURIComponent(since)}`).then(parseTagChunk));
/** 허용 집합 안의 파일 주소(서버가 고른 것만 열린다 — 보여 준 파일·예약 지침서·HQ starter). thumb = 그림 긴 변 480px JPEG */
/** 썸네일 긴 변 — 작은 카드 360·큰 카드 720·오피스 첫 장 크게 1600 */
export type ThumbSize = 360 | 720 | 1600;
export const fileUrl = (path: string, thumb = false, size?: ThumbSize) => `/api/file?path=${encodeURIComponent(path)}${thumb ? `&thumb=1${size ? `&size=${size}` : ''}` : ''}`;
/** 그림·PDF 는 <img src> 가 토큰을 못 실으니 fetch(Bearer) 로 받아 blob 주소로 — 다 쓰면 URL.revokeObjectURL */
export const fileBlobUrl = (path: string, thumb = false, size?: ThumbSize) => call(fileUrl(path, thumb, size)).then((r) => r.blob()).then((b) => URL.createObjectURL(b));
/** 그림 보기 — 보기용(크거나 무거우면 맥이 JPEG 2560 으로 줄임) 또는 원본. w·h = 원본 크기(X-Image-Size), served = 받은 그림 가로 */
export async function fileImage(path: string, original = false): Promise<{ url: string; w: number; h: number }> {
  const r = await call(`/api/file?path=${encodeURIComponent(path)}${original ? '' : '&view=1'}`);
  const m = /^(\d+)x(\d+)$/.exec(r.headers.get('X-Image-Size') ?? '');
  const url = URL.createObjectURL(await r.blob());
  return { url, w: m ? Number(m[1]) : 0, h: m ? Number(m[2]) : 0 };
}
export const readFileText = (path: string) => getText(fileUrl(path));
/** html 시안 표 주소 — iframe 은 열쇠를 못 실어서 10분 사는 표로 연다(서버가 sandbox allow-scripts 로 낸다) */
/** 영상 표 주소(+크기) — <video> 는 열쇠를 못 실어서 표로, 서버가 Range 로 나눠 준다 */
export const mediaTicket = (path: string) => post<{ url: string; size: number }>('/api/media-ticket', { path });
/** 워드 → html(맥 textutil) — 폰이 거른 뒤 그린다 */
export const wordHtml = (path: string) => getText(`/api/file?path=${encodeURIComponent(path)}&as=html`);
/** 엑셀 표(읽기만) — 맥 스페이스와 같은 Rust 읽기, 시트마다 앞 2000행(cut = 잘린 행 수) */
export const sheetBook = (path: string) => getJson<import('../domain/sheetBook').SheetBook & { sheets: { cut?: number }[] }>(`/api/file?path=${encodeURIComponent(path)}&as=sheet`);
/** 폰 진단 한 줄 — 맥 notify.log 'phone-diag'(서버가 키=값 낱말만 받는다, 10초에 한 번). 실패는 버린다 */
export const phoneDiag = (kind: string, line: string) => post<{ ok: true }>('/api/diag', { kind, line }).then(() => undefined, () => undefined);
/** 맥에서 열기 — 맥 기본 앱으로(보여 준 것만) */
export const openOnMac = (path: string) => post<{ ok: true }>('/api/open-mac', { path }).then(() => undefined);
export const htmlTicket = (path: string) => post<{ url: string }>('/api/html-ticket', { path });
/** 받기 표 — 보여 준 파일 원본(진짜 MIME·attachment·Range). 표 주소라 열쇠 없이 링크로도 받는다 */
export const dlTicket = (path: string) => post<{ url: string; size: number; name: string; mime: string }>('/api/dl-ticket', { path });
/** 시안 검토 표시 — 맥 curation/ 에(데스크톱과 같은 파일) */
export const curationSave = (path: string, text: string, store: unknown) => post<{ ok: true }>('/api/curation', { path, text, store });
export const curationState = (path: string) => getText(`/api/curation-state?path=${encodeURIComponent(path)}`);
/** PDF 바이트 — 앱 안 보기(pdf.js) */
export const fileBytes = (path: string) => call(fileUrl(path)).then((r) => r.arrayBuffer());
/** md 속 그림 — 그 문서(doc)가 가리킨 그림만 서버가 열어 준다. 보기용(크면 JPEG 2560) */
export const docImageUrl = (path: string, doc: string) =>
  call(`/api/file?path=${encodeURIComponent(path)}&doc=${encodeURIComponent(doc)}&view=1`).then((r) => r.blob()).then((b) => URL.createObjectURL(b));
/** 붙이기 — 그림·pdf·zip·txt·md·csv·json(서버가 앞 바이트로 다시 본다). 맥 <데이터>/attach 에 서버가 지은 이름으로 저장한 경로를 돌려준다.
 *  다음 보내기 글에 그 경로를 붙이면 비서가 읽는다(데스크톱 끌어 놓기와 같은 모양). 이름은 확장자 힌트로만 */
export const attachFile = (file: File) =>
  call(`/api/attach?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file })
    .then((r) => r.json() as Promise<{ path: string }>);
/** 파일 보관함 — 폰이 열 수 있는 것만(맥이 거름). 모양은 데스크톱 locker_read 와 같다 */
export const readLocker = () => getJson<import('../domain/locker').LockerView>('/api/locker');
/** 폰이 올린 첨부(attachFile 경로)를 그 참모 보관함에 — 맥이 보관함 복사본으로 옮겨 둔다 */
export const lockerAdd = (owner: string, path: string) => post<{ path: string }>('/api/locker-add', { owner, path });
/** 폰 홈·보관함 v1 — 그 참모 보관함 안에만(맥이 다시 거른다). 바로가기(폰이 보는 파일만)·되돌리기(바로가기만 뺌)·새 문서(md)·새 폴더·md 저장 */
export const lockerAlias = (owner: string, path: string, folder: string) => post<{ path: string }>('/api/locker-alias', { owner, path, folder });
export const lockerUnalias = (owner: string, rel: string) => post<{ ok: true }>('/api/locker-unalias', { owner, rel });
export const lockerNewDoc = (owner: string, folder: string, title: string) => post<{ path: string }>('/api/locker-new', { owner, folder, title });
export const lockerMkdir = (owner: string, parent: string, name: string) => post<{ rel: string }>('/api/locker-mkdir', { owner, parent, name });
export const lockerWrite = (owner: string, path: string, text: string) => post<{ ok: true }>('/api/locker-write', { owner, path, text });
/** 폰 홈 모드 카드 — 목록 · 한 칸(상태 + 보이는 칸 트리, 크기는 글자 칸) · 누름 · 맛보기 예시 켜기(그 참모 홈에) */
export type PhoneModeRow = { name: string; title: string; source: string; on: boolean; where: string; dash: string | null; alive: boolean; hidden?: boolean };
export const readModes = () => getJson<PhoneModeRow[]>('/api/modes');
export const readModeView = (name: string, columns: number, rows: number, signal?: AbortSignal) =>
  getJson<{ state: { alive: boolean; ready: boolean; unsupported: boolean; status: string | null; error: string | null }; tree?: unknown }>(`/api/mode-view?name=${encodeURIComponent(name)}&columns=${columns}&rows=${rows}`, signal);
export const modeAct = (name: string, act: object) => post<{ handled?: boolean }>('/api/mode-act', { name, act });
export const modeOpen = (name: string, dash: string) => post<{ ok: true }>('/api/mode-open', { name, dash });
/** 이 홈에서 끄기 — dash = 그 모드가 켜진 홈(목록의 dash 그대로), 맥이 그 홈에 켜진 것만 끈다 */
export const modeClose = (name: string, dash: string) => post<{ ok: true }>('/api/mode-close', { name, dash });
/** 지우기(기본 = 숨기기, 내 모드 = 제거 — 원본 휴지통은 데스크톱에서만)·되돌리기 */
export const modeRemove = (name: string) => post<{ kind: 'hidden' | 'removed'; trashed: string | null; undo: boolean }>('/api/mode-remove', { name });
export const modeRestore = (name: string) => post<{ ok: true }>('/api/mode-restore', { name });
/** 고르기 카드 그림(거름은 화면 domain/modeCard) */
export const modeCard = (name: string) => getJson<unknown>(`/api/mode-card?name=${encodeURIComponent(name)}`);
export const routineDo = (name: string, action: 'run' | 'pause' | 'resume') => post<{ ok: true; out: string }>('/api/routine', { name, action });

/** 참모 프사 — 데스크톱에서 바꾼 모양·그림을 폰에도. 그림은 토큰을 실어 받아 blob 주소로(키로만 찾는다) */
const avatarBlobs = new Map<string, string>();
const avatarBlobV = new Map<string, number>(); // 다시 읽을 때(돌아옴마다) 판이 같은 그림은 다시 안 받는다
export async function readAvatarsForPhone(): Promise<unknown> {
  const list = await getJson<{ key: string; avatar: { kind: string }; v: number }[]>('/api/avatars');
  await Promise.all(list.filter((e) => e.avatar.kind === 'image').map(async (e) => {
    if (avatarBlobs.has(e.key) && avatarBlobV.get(e.key) === e.v) return;
    try {
      const blob = await call(`/api/avatar-image?key=${encodeURIComponent(e.key)}`).then((r) => r.blob());
      const old = avatarBlobs.get(e.key);
      if (old) URL.revokeObjectURL(old);
      avatarBlobs.set(e.key, URL.createObjectURL(blob));
      avatarBlobV.set(e.key, e.v);
    } catch {
      // 그림을 못 받으면 OrchAvatar 가 기본형으로 그린다
    }
  }));
  return list;
}
export const avatarBlobUrl = (key: string) => avatarBlobs.get(key) ?? null;
/** 참모 프로필 저장(모양·색·목소리) — 켜진 HQ 참모만, 열쇠는 맥이 그 세션 이름에서 뽑는다. null = 처음대로. 답 = 저장한 값(store applySaved 가 다시 거른다) */
export const saveOrchAvatar = (id: string, avatar: import('../domain/avatar').Avatar | null) => post<unknown>('/api/avatar', { id, avatar });

/** 꺼진 참모를 그 대화 그대로 다시 켠다(HQ 폴더 것만 — 서버가 다시 본다). already = 이미 켜져 있어서 아무것도 안 했다(낡은 목록에서 누름) */
export const respawnOrch = (sessionId: string) => post<{ ok: true; already?: boolean }>('/api/respawn', { sessionId }).then((r) => ({ already: !!r.already }));
/** 새 참모 — 별명만 보내고 진짜 이름(번호)은 서버가 지어 돌려준다 */
export const spawnOrch = (nick: string, role = '') => post<{ ok: true; name: string }>('/api/spawn', { nick, role }).then((r) => r.name);

/** 사람 개입 켜기·돌려주기(세션이 부르는 중이면 돌려주기 = '다 했어') — 그 세션(sessionPid)의 브라우저일 때만 */
/** 세션 브라우저 화면 다시 받기 — 맥 모달의 다시 시도(agent_retry)와 같다 */
export const browserRetry = (profile: string, sessionPid: number) => post<{ ok: true }>('/api/browser-retry', { profile, sessionPid }).then(() => undefined);
export const browserTakeover = (profile: string, sessionPid: number, on: boolean) => post<{ ok: true }>('/api/browser-takeover', { profile, sessionPid, on }).then(() => undefined);
/** 개입 중 누르기·글자·스크롤 — 맥이 개입·부름이 아니면 버린다 */
export const browserInput = (profile: string, sessionPid: number, events: import('../domain/agentInput').InputEv[]) => post<{ ok: true }>('/api/browser-input', { profile, sessionPid, events }).then(() => undefined);

/** 폰 푸시 — 맥 앱의 VAPID 공개 키, 이 기기 구독 넣기·빼기(구독은 열쇠의 기기에 묶인다) */
export const getPushKey = () => getJson<{ key: string }>('/api/push-key').then((r) => r.key);
export const pushSubscribe = (sub: PushSubscriptionJSON) => post<{ ok: true }>('/api/push-subscribe', sub).then(() => undefined);
export const pushUnsubscribe = (endpoint: string) => post<{ ok: true }>('/api/push-unsubscribe', { endpoint }).then(() => undefined);

/** 홈 화면 앱 연결 코드 — 이 기기(열쇠)로 새 일회용 코드(10분·한 번)를 받는다. 홈 화면 앱에 붙여 넣어 짝짓는다 */
export const newPairCode = () => post<{ code: string; expires: number }>('/api/pair-code', {});

export const setPin = (sessionId: string, on: boolean) => post<string[]>('/api/pin', { sessionId, on });
/** 참모 별명 — 맥 앱 별명이 바뀌고 쉬는 때 /rename '참모-N · 별명'(앞 번호는 맥이 진짜 이름에서). 빈 글 = 설정 이름으로 */
export const renameOrch = (id: string, nick: string) => post<{ ok: true }>('/api/rename', { id, nick }).then(() => undefined);
/** 켜진 참모만(id), 비우면 지움. 돌려주는 건 바뀐 전체 */
export const setRole = (id: string, role: string) => post<Record<string, { role: string; at: number }>>('/api/role', { id, role });
export const removeOrch = (id: string) => post<{ ok: true }>('/api/remove', { id }).then(() => undefined);
export const stopOrch = (id: string) => post<{ ok: true }>('/api/stop', { id }).then(() => undefined);
/** 맥 앱 음성 모드(폰 입력창 마이크) — 읽기·켜고 끄기(scripts/app voice 와 같은 통로) */
export const readVoice = () => getText('/api/voice').then((t) => (JSON.parse(t) as { on?: boolean }).on === true);
export const setVoiceMode = (on: boolean) => post<{ on: boolean }>('/api/voice-mode', { on }).then((r) => r.on);
/** 폰 음성(맥이 만든 소리를 폰에서) — 하트비트(보고 있음·소리 소식) → 가져갈 소리·멈춤 번호 / 내놓은 소리 파일(wav). 시간 제한은 부르는 쪽(data/phoneVoice)이 신호로 */
export const voiceBeat = (body: object, signal?: AbortSignal, keepalive = false) =>
  call('/api/voice-beat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal, keepalive }).then((r) => r.json() as Promise<import('../domain/phoneVoice').BeatReply>);
export const voiceAudioBlob = (id: number, signal?: AbortSignal) => call(`/api/voice-audio?id=${id}`, { signal }).then((r) => r.blob());
/** 참모 모델·에포트 바꾸기 — 맥 앱이 데스크톱 칩과 같은 길로 친다(새 세션 기본값은 되돌림). 새 값은 상태줄(ctx)로 */
export const pickOrchModel = (id: string, want: { model?: 'opus' | 'sonnet' | 'haiku'; effort?: string }) => post<{ ok: true }>('/api/model', { id, ...want }).then(() => undefined);
