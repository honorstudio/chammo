import { useEffect, useState } from 'react';
import { readTama, writeTama } from '../../data/tauri';
import { parseTamaFile, type TamaFile } from '../../domain/tama/store';
import { TamaPage } from './TamaPage';

/** 더보기 창 — 파일은 2초마다 새로 읽고(메인 창·위젯이 같이 쓴다), 사람 조작은 읽고-바꾸고-쓰기(useTama.apply 와 같은 방식) */
export function TamaMore() {
  const [file, setFile] = useState<TamaFile | null>(null);
  useEffect(() => {
    const pull = () => void readTama().then((t) => setFile(parseTamaFile(t))).catch(() => {});
    pull();
    const t = setInterval(pull, 2000);
    return () => clearInterval(t);
  }, []);
  const apply = async (op: (f: TamaFile, now: number) => TamaFile | null) => {
    const next = op(parseTamaFile(await readTama()), Date.now());
    if (!next) return false;
    await writeTama(JSON.stringify(next));
    setFile(next);
    return true;
  };
  return (
    <div className="tama-more">
      <TamaPage file={file} apply={apply} />
    </div>
  );
}
