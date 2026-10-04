// 입력칸 줄 — [참모 프사(물음 숫자 점)] [붙이기(클립)] [입력칸 (안 오른쪽에 보내기 ↵ | 멈춤 ■)]. 프사를 누르면 참모 바꾸기(OrchPicker)
// 누르고 말하기는 뺐다 — 사용자은 아이폰 받아쓰기를 쓴다(2026-10-03 "입력창이 비좁아"). 보내기·멈춤은 입력칸 안에 둬서 글을 쓰기 시작해도 폭이 안 흔들린다
// 붙인 것은 입력칸 위 가로로 넘기는 썸네일 칩 + 입력칸에 @img1·@file1 이름표(데스크톱 채팅과 같은 셈, 칩을 빼면 이름표도)
// 버튼은 누르는 자리 44px·아이콘은 작게. 입력칸은 6~7줄(또는 화면 26%)까지 늘고 그 뒤로는 안에서 스크롤
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { attachFile } from '../../data/web';
import { IconClip, IconEnter, IconStop } from '../Icons';
import { dropLabel } from '../../domain/mobile';
import { labelCounts, readDraft, writeDraft } from '../../domain/mobileOutbox';
import { storage } from './outbox';
import { shrinkImage } from './shrink';
import { useBlobUrl } from './useBlobUrl';

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
  /** 참모가 일하는 중 — 입력칸 옆에 멈춤(■) */
  busy: boolean;
  stopping: boolean;
  onStop: () => void;
  onChip: () => void;
  onFocus: () => void;
  /** 보낼 함에 넣으면 true — 입력칸을 비운다 */
  send: (text: string, paths: string[]) => boolean;
};

type Att = { path: string; name: string; image: boolean; label: string; url?: string };

/** 붙인 것 칩의 그림 — 방금 고른 건 로컬 blob, 쓰던 글에서 되살린 건 맥에서 썸네일로 */
function AttPic({ a }: { a: Att }) {
  const remote = useBlobUrl(a.url ? null : a.path, true);
  const src = a.url ?? remote;
  return src ? <img src={src} alt="" /> : <span className="m-att-file" />;
}

export function Composer({ avatar, orchName, waiting, placeholder, draftKey, maxInputH, busy, stopping, onStop, onChip, onFocus, send }: Props) {
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
    el.style.height = `${Math.min(el.scrollHeight, maxInputH)}px`;
    el.style.overflowY = el.scrollHeight > maxInputH ? 'auto' : 'hidden';
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
        return { path: g.path, name: f.name, image, url, label: image ? `@img${++count.current.img}` : `@file${++count.current.file}` };
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
  return (
    <div className="m-composer">
      {files.length > 0 && (
        <div className="m-attached">
          {files.map((f) => (
            <span key={f.path} className="m-att">
              {f.image ? <AttPic a={f} /> : <span className="m-att-file">{f.name.split('.').pop()?.toUpperCase().slice(0, 4) || '파일'}</span>}
              <span className="m-att-label">{f.label}</span>
              <button type="button" className="m-att-x" onClick={() => remove(f)} aria-label={`${f.label} ${f.name} 빼기`}>✕</button>
            </span>
          ))}
        </div>
      )}
      {err && <div className="m-error">{err}</div>}
      <form className="m-input" onSubmit={(e) => { e.preventDefault(); if (send(draft, paths)) { setDraft(''); clear(); } }}>
        <button type="button" className="m-orchchip" onClick={onChip} aria-label={`${orchName} — 비서 바꾸기${waiting > 0 ? `, 답을 기다리는 비서 ${waiting}` : ''}`}>
          {avatar}
          {waiting > 0 && <span className="m-wait-n">{waiting}</span>}
        </button>
        <button type="button" className="m-icon" disabled={uploading} onClick={() => file.current?.click()} aria-label={uploading ? '올리는 중' : '그림·파일 붙이기'}>
          <IconClip />
        </button>
        <input ref={file} type="file" accept="image/*,.pdf,.txt,.md,.csv,.json,.zip,application/pdf,text/plain,text/markdown,text/csv,application/json,application/zip" multiple hidden onChange={(e) => void pick(e.target.files)} />
        <div className={canSend || busy ? 'm-field m-has-btn' : 'm-field'}>
          <textarea ref={box} value={draft} rows={1} placeholder={placeholder} onFocus={onFocus} onChange={(e) => setDraft(e.target.value)} />
          {canSend ? (
            <button type="submit" className="m-in-btn" disabled={uploading} aria-label="보내기" title="보내기">
              <span className="m-key"><IconEnter /></span>
            </button>
          ) : busy ? (
            <button type="button" className="m-in-btn m-stop" disabled={stopping} onClick={onStop} aria-label={`${orchName} 하던 일 멈추기`} title="멈춤">
              <span className="m-stop-key"><IconStop /></span>
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
