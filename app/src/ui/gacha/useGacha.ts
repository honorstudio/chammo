// 머지 가챠 상태: gacha.json 을 읽고, 다마고치 먹이 사건(feed)이 오면 코인을 쌓아 다시 쓴다. 뽑기도 여기서.
// 고치기는 전부 한 줄(editor) — 코인 적립이 가구 놓기·뽑기 사이에 끼어 옛 파일로 덮지 않게
import { useCallback, useEffect, useState } from 'react';
import { commitLog, readGacha, readTama, writeGacha, type AppEnv } from '../../data/tauri';
import { firstPetAt, moveFromTama } from '../../domain/moveTama';
import { parseCommitLog } from '../../domain/tama/sources';
import { parseTamaFile } from '../../domain/tama/store';
import { assignProject, buyExpand, buyOffice, dayStartAt, earn, ensureOrchSeats, pull, seeItem, setChar, setOrchSeat, setRoomSkin, toggleEquip, type GachaFile, type OrchSeat, type PullResult } from '../../domain/gacha';
import { phoneAnswer, type PhoneReply } from '../../domain/phoneGacha';
import type { TamaEvent } from '../../domain/tama/pet';
import { makeEditor } from './editor';

// 처음 켠 날은 그날 새벽 5시부터 한 일이 첫 코인
const edit = makeEditor(readGacha, writeGacha, () => dayStartAt(Date.now()));

export function useGacha(env: AppEnv | null, feed: TamaEvent[]) {
  const [file, setFile] = useState<GachaFile | null>(null);
  /** 방금 들어온 코인 — 사무실 코인 칸이 잠깐 반짝인다 */
  const [gain, setGain] = useState<{ n: number; at: number } | null>(null);

  useEffect(() => {
    if (!env) return;
    let alive = true;
    const now = Date.now();
    let gained = 0;
    void edit((f) => { const r = earn(f, feed, now); gained = r.gained; return r.file; }).then((f) => {
      if (!alive) return;
      setFile(f);
      if (gained > 0) setGain({ n: gained, at: now });
    }).catch(() => {});
    return () => { alive = false; };
  }, [env, feed]);

  // 다마고치를 없애며 쌓인 걸 옮긴다 — 일한 시간·커밋은 코인으로, 해금한 모습은 캐릭터로. 한 번만(gacha.json tamaMoved), 곰 한 마리는 누구나
  useEffect(() => {
    if (!env) return;
    let alive = true;
    void (async () => {
      const t = parseTamaFile(await readTama());
      const since = firstPetAt(t);
      const commits = since !== null && env.gitEmail ? parseCommitLog(await commitLog(env.devRoot, env.gitEmail, new Date(since).toISOString())).filter((e) => e.type === 'commit').length : 0;
      const f = await edit((x) => moveFromTama(x, t, commits, Date.now()));
      if (alive) setFile(f);
    })().catch(() => { /* 다음에 켤 때 다시 */ });
    return () => { alive = false; };
  }, [env]);

  /** 바꾸고 화면에도 — 바뀐 게 없으면 화면 그대로 */
  const change = useCallback(async (op: (f: GachaFile) => GachaFile | null) => {
    const next = await edit(op);
    if (next) setFile(next);
    return next;
  }, []);

  /** 뽑기 — 코인이 모자라면 null */
  const draw = useCallback(async (n: 1 | 10): Promise<PullResult[] | null> => {
    let results: PullResult[] | null = null;
    await change((f) => { const r = pull(f, n, Math.random); results = r?.results ?? null; return r?.file ?? null; });
    return results;
  }, [change]);

  /** 도감에서 누르기 — NEW 끄고, 스킨·모자·창밖·이펙트·반장 액션이면 장착/해제(가구·펫 친구는 NEW 만) */
  const equip = useCallback(async (id: string) => { await change((f) => toggleEquip(seeItem(f, id), id)); }, [change]);

  /** 스킨 고르기 — 사무실마다(첫 사무실은 equip.skin 그대로), 'wood' = 기본 */
  const setSkin = useCallback(async (i: number, name: string) => { await change((f) => setRoomSkin(seeItem(f, `skin.${name}`), i, name)); }, [change]);

  /** 넓히기·사무실 열기 — 코인이 모자라면 그대로 */
  const expand = useCallback(async (i: number) => { await change((f) => buyExpand(f, i)); }, [change]);
  const openOffice = useCallback(async () => { await change((f) => buyOffice(f)); }, [change]);
  /** 참모 캐릭터 고르기 */
  const pickChar = useCallback(async (name: string, id: string) => { await change((f) => setChar(seeItem(f, id), name, id)); }, [change]);
  /** 출근 명단 — 참모 책상 사무실·프로젝트 사무실 */
  const orchSeat = useCallback(async (name: string, seat: OrchSeat | null) => { await change((f) => setOrchSeat(f, name, seat)); }, [change]);
  const assign = useCallback(async (project: string, i: number) => { await change((f) => assignProject(f, project, i)); }, [change]);
  /** 켜진 참모에게 기본 자리 적어 두기 — 꺼져도 빈자리가 남게 */
  const ensureSeats = useCallback(async (names: string[]) => { await change((f) => ensureOrchSeats(f, names)); }, [change]);

  /** NEW 끄기만 — 도감에서 눌러 봄 */
  const see = useCallback(async (id: string) => { await change((f) => seeItem(f, id)); }, [change]);

  /** 폰 요청(폰 서버 → window.__gachaPhone) — 데스크톱 뽑기·장착과 같은 한 줄에서. off = 이 맥에서 뽑기 기능을 꺼 둠 */
  const phone = useCallback(async (raw: unknown, off: boolean): Promise<PhoneReply> => {
    let reply: PhoneReply | null = null;
    await change((f) => { const r = phoneAnswer(f, raw, off, Math.random, Date.now()); reply = r.reply; return r.file; });
    return reply!;
  }, [change]);

  return { file, gain, draw, equip, setSkin, see, phone, change, expand, openOffice, pickChar, orchSeat, assign, ensureSeats };
}
