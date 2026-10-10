import { describe, expect, it } from 'vitest';
import { hatch, type Pet } from './pet';
import { sceneFor } from './scene';

const at = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m).getTime();
const pet = (o: Partial<Pet> = {}): Pet => ({ ...hatch('fire', at(28, 9), 0.3), fedFull: 3, ...o });
const base = { busy: false, justEvolved: false };

describe('sceneFor — 위젯이 지금 보여줄 장면과 켜질 표시등', () => {
  it('평소엔 걷기, 표시등은 다 꺼짐', () => {
    expect(sceneFor(pet(), at(28, 14), base)).toEqual({ scene: 'walk', lit: [] });
  });

  it('펫이 없으면 알 고르기', () => {
    expect(sceneFor(null, at(28, 14), base).scene).toBe('pick');
  });

  it('죽었으면 무덤', () => {
    expect(sceneFor(pet({ dead: { at: 1, slot: 'r1' } }), at(28, 14), base).scene).toBe('dead');
  });

  it('방금 진화했으면 진화 장면이 먼저', () => {
    expect(sceneFor(pet({ sick: true }), at(28, 14), { ...base, justEvolved: true }).scene).toBe('evolve');
  });

  it('장애 몬스터가 나와 있으면 마주 선 장면 + 부르기 표시등 — 아플 땐 아픔이 먼저, 자는 밤엔 그냥 잔다', () => {
    expect(sceneFor(pet(), at(28, 14), { ...base, monster: true })).toEqual({ scene: 'monster', lit: ['call'] });
    expect(sceneFor(pet({ sick: true }), at(28, 14), { ...base, monster: true }).scene).toBe('sick');
    expect(sceneFor(pet(), at(28, 3), { ...base, monster: true }).scene).toBe('sleep');
  });

  it('90초 안에 커밋이 들어왔으면 밥 먹기 + 밥 표시등', () => {
    expect(sceneFor(pet({ recent: [at(28, 13, 59)] }), at(28, 14), base)).toEqual({ scene: 'eat', lit: ['food'] });
    expect(sceneFor(pet({ recent: [at(28, 13, 58)] }), at(28, 14), base).scene).toBe('walk');
  });

  it('아프면 아픔 장면 + 약·호출', () => {
    expect(sceneFor(pet({ sick: true }), at(28, 14), base)).toEqual({ scene: 'sick', lit: ['med', 'call'] });
  });

  it('밤(0~9시)엔 잠 + 불 표시등. 주말 낮은 깨어 있다', () => {
    expect(sceneFor(pet(), at(29, 2), base)).toEqual({ scene: 'sleep', lit: ['light'] });
    expect(sceneFor(pet(), at(27, 14), base).scene).toBe('walk');
  });

  it('똥이 있으면 똥 장면 + 청소·호출, 배가 비면 호출', () => {
    expect(sceneFor(pet({ poops: 1 }), at(28, 14), base)).toEqual({ scene: 'poop', lit: ['clean', 'call'] });
    expect(sceneFor(pet({ fedFull: 0 }), at(28, 14), base).lit).toEqual(['call']);
  });

  it('세션이 일하는 중이면 훈련 표시등', () => {
    expect(sceneFor(pet(), at(28, 14), { ...base, busy: true }).lit).toEqual(['train']);
  });
});
