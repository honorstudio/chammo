// 파일 크게 보기 — 바닥 전체를 덮는다. 그림은 전용 보기, PDF 는 앱 안(pdf.js), md 는 노션식 읽기, 코드·글은 줄 번호, csv 는 표.
// 짚은 곳(at)이 있으면 그리로. 서버가 허용 집합 밖·글 속 비밀은 403
import { useEffect, useState } from 'react';
import { readFileText } from '../../data/web';
import { fileError, fileKind } from '../../domain/phoneFile';
import { machine } from '../../i18n';
import type { ShowAt } from '../../domain/showAt';
import { useBlobUrl } from './useBlobUrl';
import { ImageViewer } from './ImageViewer';
import PdfSheet from './PdfSheet';
import HtmlSheet from './HtmlSheet';
import { OfficeSheet, VideoSheet } from './OfficeSheet';
import { CodeText, CsvTable, MdDoc } from './FileText';
import { IconClose } from '../Icons';

// 붙은 컴퓨터(맥·PC)는 env 를 받은 뒤에 정해져서 모듈 상수가 아니라 부를 때 만든다
const why = (): Record<string, string> => ({ 'secret inside': `글 속에 키가 보여서 폰엔 안 보여 줘요 — ${machine()}에서 열어 주세요`, 'not allowed': '폰에서 열 수 없는 파일이에요', 'file too large': `너무 커서 폰에선 못 열어요 — ${machine()}에서` });

export function FileView({ path, title, at, orch, onClose }: { path: string; title: string; at?: ShowAt; orch?: string; onClose: () => void }) {
  const data = path.startsWith('data:image/');
  const kind = data ? 'image' : fileKind(path);
  // 맥 파일 그림은 전용 보기(화면 꽉·맞춤·두 번 톡 1:1·원본 더 받기). 붙인 그림(data:)은 아래 그대로
  if (kind === 'image' && !data) return <ImageViewer path={path} title={title} onClose={onClose} />;
  if (kind === 'pdf') return <PdfSheet path={path} title={title} at={at} onClose={onClose} />;
  if (kind === 'office') return <OfficeSheet path={path} title={title} onClose={onClose} />;
  if (kind === 'video') return <VideoSheet path={path} title={title} onClose={onClose} />;
  if (kind === 'html') return <HtmlSheet path={path} title={title} orch={orch} onClose={onClose} />;
  return <TextView path={path} data={data} kind={kind} title={title} at={at} onClose={onClose} />;
}

function TextView({ path, data, kind, title, at, onClose }: { path: string; data: boolean; kind: string; title: string; at?: ShowAt; onClose: () => void }) {
  const blob = useBlobUrl(data ? path : null);
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<{ text: string; gone: boolean } | null>(null);
  useEffect(() => {
    if (data) return;
    readFileText(path).then(setText, (e: unknown) => { const m = (e as Error).message; setErr(fileError(m, why())); });
  }, [path, data]);
  return (
    <div className="m-view" role="dialog" aria-label={title}>
      <div className="m-picker-head">
        <b className="m-view-title m-view-file">{title}</b>
        <button type="button" className="m-rt-btn m-ico" onClick={onClose} aria-label="닫기" title="닫기"><IconClose /></button>
      </div>
      <div className="m-view-body">
        {data && blob && <img src={blob} alt={title} />}
        {text !== null && (kind === 'md' ? <MdDoc path={path} text={text} at={at} />
          : kind === 'csv' ? <CsvTable text={text} tab={/\.tsv$/i.test(path)} />
          : <CodeText text={text} json={kind === 'json'} at={at} />)}
        {text === null && !err && !data && <p className="m-muted">여는 중…</p>}
        {err && <p className={err.gone ? 'm-muted' : 'm-error'}>{err.text}</p>}
      </div>
    </div>
  );
}
