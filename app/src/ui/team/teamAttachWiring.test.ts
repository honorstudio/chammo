// 11-05 여러 장 올리기 — 대화 칸이 파일을 하나씩 차례로 올리고(칩마다 대기→올리는 중→크기), 10장씩 나눠 보내고, 못 보내면 칩을 되살린다
import { describe, expect, it } from 'vitest';
import convo from './TeamConvo.tsx?raw';
import bits from './RoomBits.tsx?raw';

const send = convo.slice(convo.indexOf('const send = (checked'), convo.indexOf('.finally(() => setBusy(false))', convo.indexOf('const send = (checked')));

describe('대화 첨부 배선', () => {
  it('파일 하나씩 — 한 장 실패가 묶음 전체를 실패로 만들지 않는다(차례 줄 하나)', () => {
    expect(convo).toMatch(/j\.attach\(j\.team, j\.room, \[j\.path\]\)/);
    expect(convo).toContain('attachQueue(');
    expect(convo).not.toContain('attsNow'); // 다시 그리기 전 목록으로 '뺐나'를 보면 방금 넣은 칩을 다 건너뛴다(11-05 첫 고침)
    expect(convo).toContain('queue.drop(');
    expect(convo).not.toMatch(/files\.attach\(teamId, convo\.room, paths\)/);
  });
  it('대기 칩도 올리는 중으로 친다 — 다 오르기 전엔 못 보낸다', () => {
    expect(convo).toMatch(/const uploading = atts\.some\(\(a\) => a\.busy \|\| a\.wait\)/);
  });
  it('보내기 — 10장씩 나누고, 결과를 보기 전에 칩을 다 지우지 않는다(못 보내면 다시 올려야 해서 같은 사진이 또 올라갔다)', () => {
    expect(send).toContain('sendBatches(');
    expect(send).not.toContain('setAtts([])');
    expect(send).toContain('allSettled(');
  });
  it('칩 글은 domain attNote 하나로(몇 %는 올리는 중 줄에서)', () => {
    expect(bits).toContain('attNote(');
    expect(convo).toContain('upPct(');
    expect(convo).toContain('progress = files.progress');
  });
});

import phone from '../mobile/PhoneTeam.tsx?raw';
import web from '../../data/web.ts?raw';

describe('폰 팀 대화 첨부(11-06 사용자 — 폰 팀 DM·팀챗 입력칸엔 글뿐)', () => {
  it('폰 + = 폰 기본 첨부 창(여러 개), 데스크톱과 같은 차례 줄·10장 나눔에 태운다', () => {
    expect(convo).toMatch(/<input ref=\{pickRef\} type="file" multiple hidden/);
    expect(convo).toContain('j.file && phoneAttach');
    expect(convo).toMatch(/const attachFiles = \(fs: File\[\]\)/);
  });
  it('폰은 진행 % 를 맥 명령(team_locker_poll)으로 안 묻는다 — 보낸 바이트로', () => {
    expect(convo).toMatch(/if \(!rich \|\| !upBusy/);
  });
  it('폰 say 는 파일만 있어도 보낸다(글 없이), 파일은 /api/team-say 에 싣는다', () => {
    expect(phone).toContain('extra?.files');
    expect(phone).toContain('phoneAttach={');
    expect(web).toContain("post('/api/team-say', { to, text, cid, ...(re ? { re } : {}), ...(files?.length ? { files } : {}) })");
  });
  it('폰 대화 첨부 = 보관함 조각 길(room 만 더) + 참조 묻기', () => {
    expect(web).toContain('&room=${encodeURIComponent(room)}');
    expect(web).toContain('/api/team-file-ref?up=');
  });
});
