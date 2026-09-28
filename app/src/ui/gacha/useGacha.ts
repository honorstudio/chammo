// 머지 가챠 상태: gacha.json 을 읽고, 다마고치 먹이 사건(feed)이 오면 코인을 쌓아 다시 쓴다. 뽑기도 여기서
import { useCallback, useEffect, useState } from 'react';
import { readGacha, writeGacha, type AppEnv } from '../../data/tauri';
import { dayStartAt, earn, parseGacha, place, pull, toggleEquip, type GachaFile, type PullResult } from '../../domain/gacha';
import type { TamaEvent } from '../../domain/tama/pet';

export function useGacha(env: AppEnv | null, feed: TamaEvent[]) {
  const [file, setFile] = useState<GachaFile | null>(null);
  /** 방금 들어온 코인 — 사무실 코인 칸이 잠깐 반짝인다 */
  const [gain, setGain] = useState<{ n: number; at: number } | null>(null);

  useEffect(() => {
    if (!env) return;
    let alive = true;
    void (async () => {
      const now = Date.now();
      const raw = await readGacha();
      const f = parseGacha(raw, dayStartAt(now)); // 처음 켠 날은 그날 새벽 5시부터 한 일이 첫 코인
      const r = earn(f, feed, now);
      if (r.file !== f || !raw) await writeGacha(JSON.stringify(r.file));
      if (!alive) return;
      setFile(r.file);
      if (r.gained > 0) setGain({ n: r.gained, at: now });
    })().catch(() => {});
    return () => { alive = false; };
  }, [env, feed]);

  /** 뽑기 — 파일을 새로 읽어 뽑고 바로 쓴다(코인 적립과 겹쳐도 안 잃게). 코인이 모자라면 null */
  const draw = useCallback(async (n: 1 | 10): Promise<PullResult[] | null> => {
    const f = parseGacha(await readGacha(), dayStartAt(Date.now()));
    const r = pull(f, n, Math.random);
    if (!r) return null;
    await writeGacha(JSON.stringify(r.file));
    setFile(r.file);
    return r.results;
  }, []);

  /** 도감에서 누르기 — 모자·창밖·이펙트·반장 액션 장착/해제 */
  const equip = useCallback(async (id: string) => {
    const f = parseGacha(await readGacha(), dayStartAt(Date.now()));
    const next = toggleEquip(f, id);
    if (next === f) return;
    await writeGacha(JSON.stringify(next));
    setFile(next);
  }, []);

  /** 가구 놓기 — 칸에(null = 창고) */
  const placeItem = useCallback(async (id: string, cell: [number, number] | null) => {
    const f = parseGacha(await readGacha(), dayStartAt(Date.now()));
    const next = place(f, id, cell);
    if (next === f) return;
    await writeGacha(JSON.stringify(next));
    setFile(next);
  }, []);

  return { file, gain, draw, equip, placeItem };
}
