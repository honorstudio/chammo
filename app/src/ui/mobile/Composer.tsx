// 입력창 = 두 줄 카드(시안 docs/design-drafts/phone-dash K, 2026-10-11 사용자 — Claude 아이폰 앱 결): 위 = 글, 아래 = [붙이기 +] [칩 자리] … [스피커] [한 자리].
// 참모 프사(누르면 참모 바꾸기, 물음 숫자 점)는 늘 보인다 — 비었으면 오른쪽 아래, 글이 있으면 보내기(↑) 왼쪽 스피커 자리. 멈춤(■)은 일하는 중일 때만
// 칩 옆 따로 한 칸(domain/phoneComposer composerSlots). 프사 둘레 = 그 참모 컨텍스트 고리(80% 넘으면 빨강, 시안 phone-dash v2 A), 일하는 중이면 파란 점
// 붙인 것은 카드 안 맨 위 가로로 넘기는 썸네일 칩 + 글에 #img1·#file1 이름표(데스크톱 채팅과 같은 셈, 칩을 빼면 이름표도)
// 버튼은 누르는 자리 44px·아이콘은 작게. 글 칸은 6줄(화면이 작으면 그보다 작게)까지 늘고 그 뒤로는 안에서 스크롤
// 음성이 나오는 동안 참모 프사는 말하는 참모 프사·색으로 바뀌고 소리 크기대로 빛난다(speaker, ui/mobile/usePhoneSpeaker) — 다른 참모면 누르면 그 참모로
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { attachFile } from '../../data/web';
import { IconArrowUp, IconClose, IconPlus, IconStop } from '../Icons';
import { composerSlots, textMaxH } from '../../domain/phoneComposer';
import { dropLabel } from '../../domain/mobile';
import { labelCounts, readDraft, writeDraft } from '../../domain/mobileOutbox';
import { storage } from './outbox';
import { shrinkImage } from './shrink';
import { useBlobUrl } from './useBlobUrl';
import { AvatarRing } from './kit';
import { useSpeakLevel } from './usePhoneSpeaker';

type Props = {
  /** 참모 프사(OrchAvatar 자리) */
  avatar: ReactNode;
  /** 화면 읽기용 참모 이름 */
  orchName: string;
  waiting: number;
  placeholder: string;
  /** 쓰던 글을 기억할 칸(참모 id) — 참모를 바꿨다 와도 쓰던 글·붙인 파일이 남는다 */
  draftKey: string;
  /** 입력칸 최대 높이(px) — 보이는 화면 높이로 정한다 */
  maxInputH: number;
  /** 그 참모 컨텍스트 %(프사 둘레 고리) — 상태줄 값이 없으면 빈 고리 */
  ctxPct?: number;
  /** 참모가 일하는 중 — 칩 옆에 멈춤(■) 한 칸, 프사에 파란 점 */
  busy: boolean;
  stopping: boolean;
  onStop: () => void;
  onChip: () => void;
  onFocus: () => void;
  /** 아래 줄 가운데 칩 자리(모델·에포트 칩·일하는 중) */
  chip?: ReactNode;
  /** 아래 줄 오른쪽 한 자리 앞 — 스피커(음성 모드) */
  voice?: ReactNode;
  /** 보낼 함에 넣으면 true — 입력칸을 비운다 */
  send: (text: string, paths: string[]) => boolean;
  /** 지금 말하는 참모(음성이 나오는 동안 + 끝난 뒤 잠깐) — 프사·참모 색·말하는 빛. onGo 가 있으면(다른 참모) 누르면 그 참모로 */
  speaker?: { id: string; avatar: ReactNode; name: string; style: CSSProperties; onGo?: () => void };
};

type Att = { path: string; name: string; image: boolean; label: string; url?: string };

/** 붙인 것 칩의 그림 — 방금 고른 건 로컬 blob, 쓰던 글에서 되살린 건 맥에서 썸네일로 */
function AttPic({ a }: { a: Att }) {
  const remote = useBlobUrl(a.url ? null : a.path, true);
  const src = a.url ?? remote;
  return src ? <img src={src} alt="" /> : <span className="m-att-file" />;
}

export function Composer({ avatar, orchName, waiting, placeholder, draftKey, maxInputH, ctxPct, busy, stopping, onStop, onChip, onFocus, chip, voice, send, speaker }: Props) {
  const [saved] = useState(() => readDraft(storage(), draftKey));
  const [draft, setDraft] = useState(saved.text);
  const [files, setFiles] = useState<Att[]>(saved.files);
  const paths = files.map((f) => f.path);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // 이번 메시지에 붙인 그림·파일 수 — 붙인 게 비면 0 으로(데스크톱 ChatView 와 같은 셈)
  const count = useRef(labelCounts(saved.files));
  // 쓰는 대로 참모 칸에 기억 — 참모를 바꾸면 이 화면이 새로 그려진다(MobileApp OrchSpace key)
  useEffect(() => writeDraft(storage(), draftKey, { text: draft, files: files.map(({ path, name, image, label }) => ({ path, name, image, label })) }), [draftKey, draft, files]);
  // 칩 썸네일(로컬 blob) — 빼거나 보내면 놓는다
  const urls = useRef(new Set<string>());
  const clear = () => {
    setFiles((fs) => { fs.forEach((f) => f.url && (URL.revokeObjectURL(f.url), urls.current.delete(f.url))); return []; });
    count.current = { img: 0, file: 0 };
  };
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  // 글 길이만큼 늘고, maxInputH 를 넘으면 안에서 스크롤
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    const cap = textMaxH(maxInputH);
    el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
    el.style.overflowY = el.scrollHeight > cap ? 'auto' : 'hidden';
  }, [draft, maxInputH]);

  const pick = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploading(true);
    setErr(null);
    onFocus(); // 살짝이면 반으로 — 붙인 뒤 한 줄 쓰기 좋게
    try {
      const picked = Array.from(list);
      // 사진은 올리기 전에 줄인다(긴 변 2048·JPEG) — 큰 사진을 LTE 로 그대로 올리다 끊겼다(2026-10-03)
      const small = await Promise.all(picked.map((f) => shrinkImage(f)));
      const got = await Promise.all(small.map((f) => attachFile(f)));
      const added: Att[] = got.map((g, i) => {
        const f = small[i]!;
        const image = f.type.startsWith('image/');
        const url = image ? URL.createObjectURL(f) : undefined;
        if (url) urls.current.add(url);
        return { path: g.path, name: f.name, image, url, label: image ? `#img${++count.current.img}` : `#file${++count.current.file}` };
      });
      setFiles((p) => [...p, ...added]);
      setDraft((d) => `${d}${d && !/\s$/.test(d) ? ' ' : ''}${added.map((a) => a.label).join(' ')} `);
    } catch (e) {
      setErr(`못 올렸어요: ${(e as Error).message}`);
    } finally {
      setUploading(false);
      if (file.current) file.current.value = '';
    }
  };
  const remove = (a: Att) => {
    if (a.url) { URL.revokeObjectURL(a.url); urls.current.delete(a.url); }
    setDraft((d) => dropLabel(d, a.label));
    setFiles((x) => {
      const left = x.filter((y) => y.path !== a.path);
      if (!left.length) count.current = { img: 0, file: 0 };
      return left;
    });
  };

  const canSend = !!draft.trim() || files.length > 0;
  const slots = composerSlots({ canSend, busy });
  // 단추 자리가 한 번이라도 바뀐 뒤부터 새로 놓인 단추에 m-cin(나타나기) — 처음 그릴 땐 안 움직인다. 자리마다 key 라 바뀔 때 새로 붙어 다시 돈다
  const slotKey = `${slots.left}/${slots.corner}`;
  const firstSlots = useRef(slotKey);
  const moved = useRef(false);
  if (slotKey !== firstSlots.current) moved.current = true;
  const cin = moved.current ? ' m-cin' : '';
  // 말하는 참모로 바뀌고 돌아올 때 — 프사 칸을 새로 붙여 m-cin(짧게 나타나기)을 다시 돌린다. 처음 그릴 땐 안 움직인다
  const swapped = useRef(false);
  if (speaker) swapped.current = true;
  const [btn, setBtn] = useState<HTMLButtonElement | null>(null);
  useSpeakLevel(btn, !!speaker);
  // 다른 참모가 말하는 중 — 고리(컨텍스트)·파란 점은 지금 참모 것이라 그동안 뺀다
  const other = !!speaker?.onGo;
  const orchBtn = (key: string) => (
    <button key={key} ref={setBtn} type="button" className={`m-cbtn m-corch${cin}${speaker ? ' m-speak' : ''}`} style={speaker?.style} onClick={speaker?.onGo ?? onChip}
      aria-label={other && speaker ? `${speaker.name} 말하는 중 — ${speaker.name}에게 가기` : `${orchName}${speaker ? ' 말하는 중' : ''}${busy ? ' 일하는 중' : ''}${ctxPct !== undefined ? `, 컨텍스트 ${Math.round(ctxPct)}%` : ''} — 비서 바꾸기${waiting > 0 ? `, 답을 기다리는 비서 ${waiting}` : ''}`}
      title={other && speaker ? `${speaker.name}에게 가기` : '참모 바꾸기'}>
      <AvatarRing pct={other ? undefined : ctxPct} dot={busy && !other ? 'st-work' : undefined} size={40}><span key={speaker?.id ?? 'own'} className={`m-cdot${swapped.current ? ' m-cin' : ''}`}>{speaker?.avatar ?? avatar}</span></AvatarRing>
      {waiting > 0 && <span className="m-wait-n">{waiting}</span>}
    </button>
  );
  return (
    <div className="m-composer">
      {err && <div className="m-error">{err}</div>}
      <form className="m-input" onSubmit={(e) => { e.preventDefault(); if (send(draft, paths)) { setDraft(''); clear(); } }}>
        {files.length > 0 && (
          <div className="m-attached">
            {files.map((f) => (
              <span key={f.path} className="m-att">
                {f.image ? <AttPic a={f} /> : <span className="m-att-file">{f.name.split('.').pop()?.toUpperCase().slice(0, 4) || '파일'}</span>}
                <span className="m-att-label">{f.label}</span>
                <button type="button" className="m-att-x" onClick={() => remove(f)} aria-label={`${f.label} ${f.name} 빼기`} title="빼기"><IconClose /></button>
              </span>
            ))}
          </div>
        )}
        <textarea ref={box} value={draft} rows={1} placeholder={placeholder} onFocus={onFocus} onChange={(e) => setDraft(e.target.value)} />
        <div className="m-crow">
          <button type="button" className="m-cbtn" disabled={uploading} onClick={() => file.current?.click()} aria-label={uploading ? '올리는 중' : '그림·파일 붙이기'} title="붙이기">
            <span className="m-cdot"><IconPlus /></span>
          </button>
          <input ref={file} type="file" accept="image/*,.pdf,.txt,.md,.csv,.json,.zip,application/pdf,text/plain,text/markdown,text/csv,application/json,application/zip" multiple hidden onChange={(e) => void pick(e.target.files)} />
          {chip}
          {slots.stop && (
            <button type="button" className="m-cbtn m-cstop-sm" disabled={stopping} onClick={onStop} aria-label={`${orchName} 하던 일 멈추기`} title="멈춤">
              <span className="m-cdot"><IconStop /></span>
            </button>
          )}
          <span className="m-crow-sp" />
          {slots.left === 'voice' ? <span key="voice" className={`m-cslot${cin}`}>{voice}</span> : orchBtn('orch-l')}
          {slots.corner === 'send' ? (
            <button key="go" type="submit" className={`m-cbtn m-cgo${cin}`} disabled={uploading} aria-label="보내기" title="보내기">
              <span className="m-cdot"><IconArrowUp /></span>
            </button>
          ) : orchBtn('orch-c')}
        </div>
      </form>
    </div>
  );
}
