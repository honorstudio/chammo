import { describe, expect, it } from 'vitest';
import { BigNum, Dots, Flow, InkCircle, Ring, SKINS, Sky, Spark, moonAge, skinOf, sunTimes, svgDoc } from '../../hq-template/.claude/skills/hq-mode-kit/kit-svg';
import { safeSvg } from './modeSvg';

// 참모 모드 Svg 키트(hq-mode-kit/kit-svg.ts) — 부품이 앱 Svg 거름을 통과하고, 스킨 층이 정지판에서도 맞게 보이는지. 값은 지어낸 것
const OCT12 = { year: 2026, month: 10, day: 12 };

describe('스킨', () => {
  it('셋 — 계기판·하늘·표지, 모르는 값은 기본', () => {
    expect(SKINS.map((s) => s.id)).toEqual(['gauge', 'sky', 'cover']);
    expect(skinOf('sky')).toBe('sky');
    expect(skinOf('neon')).toBe('gauge');
    expect(skinOf(undefined, 'cover')).toBe('cover');
  });
});

describe('svgDoc', () => {
  const doc = (leave?: boolean) => svgDoc({ maxH: 400, layers: [
    ...(leave ? [{ skin: 'cover' as const, w: 600, h: 200, body: BigNum(20, 120, '10', { size: 120, font: 'serif' }), leave: true }] : []),
    { skin: 'gauge' as const, w: 600, h: 300, body: Ring(150, 150, 100, { value: 0.4, hand: true }) },
  ] });
  it('앱 거름(safeSvg)을 통과하고 루트에 mode-anim, <style> 은 한 블록', () => {
    const { svg } = doc(true);
    expect(safeSvg(svg)).not.toBeNull();
    expect(svg).toMatch(/^<svg [^>]*class="mode-anim"/);
    expect(svg.match(/<style>/g)).toHaveLength(1);
  });
  it('바꿀 때 — 옛 층은 k-leave(기본 투명, 움직임으로만 보였다 사라짐), 새 층은 k-enter', () => {
    const { svg } = doc(true);
    expect(svg).toContain('class="k-cover k-leave"');
    expect(svg).toContain('class="k-gauge k-enter"');
    expect(svg).toMatch(/\.k-leave\{opacity:0;/);
    expect(doc(false).svg).toContain('class="k-gauge"');
  });
  it('높이가 모자라면 같은 비율로 줄인다(viewBox 는 그대로)', () => {
    const { svg, height, width } = svgDoc({ maxH: 150, layers: [{ skin: 'gauge', w: 600, h: 300, body: '' }] });
    expect(svg).toContain('viewBox="0 0 600 300"');
    expect([width, height]).toEqual([300, 150]);
  });
});

describe('부품', () => {
  it('Ring — 지난 몫 호·바늘(바깥 g 가 각도, 안쪽 g 만 돈다)', () => {
    const r = Ring(100, 100, 80, { value: 0.25, hand: true, ticks: 24 });
    expect(r).toContain('rotate(90 100 100)');
    expect(r).toContain('class="k-spin"');
    expect((r.match(/class="k-tick/g) ?? []).length).toBe(24);
  });
  it('Dots — 칸 수만큼 점, 지난 것 채움, 오늘 하나 숨쉬기', () => {
    const d = Dots(0, 0, 800, { total: 365, offset: 4, filled: 284, today: 284 });
    expect((d.match(/class="k-dot/g) ?? []).length).toBe(365);
    expect((d.match(/class="k-dot p"/g) ?? []).length).toBe(284);
    expect((d.match(/k-glow/g) ?? []).length).toBe(1);
  });
  it('Flow — 막대 N개, 지금 막대만 빛이 흐른다', () => {
    const f = Flow(0, 0, { values: [1, 0.4, 0, 0], now: 1, h: 100, labels: ['a', 'b', 'c', 'd'] });
    expect((f.match(/class="k-bar"/g) ?? []).length).toBe(4);
    expect((f.match(/k-shine/g) ?? []).length).toBe(1);
  });
  it('Spark — 값이 하나여도·전부 0 이어도 선이 나온다', () => {
    expect(Spark(0, 0, 100, 30, [3])).toContain('<path');
    expect(Spark(0, 0, 100, 30, [0, 0, 0])).toContain('<path');
  });
  it('Sky — 낮엔 해, 밤엔 달·별(날마다 같은 자리)', () => {
    const sn = sunTimes(OCT12);
    const day = Sky(800, 300, { min: 16 * 60, rise: sn.rise, set: sn.set, age: 0.1, seed: 1 });
    const night = Sky(800, 300, { min: 22 * 60, rise: sn.rise, set: sn.set, age: 0.1, seed: 1 });
    expect(day.body).toContain('class="k-sun"');
    expect(night.body).toContain('class="k-moon"');
    expect(night.body).toBe(Sky(800, 300, { min: 22 * 60, rise: sn.rise, set: sn.set, age: 0.1, seed: 1 }).body);
    expect(safeSvg(svgDoc({ maxH: 400, layers: [{ skin: 'sky', w: 800, h: 300, body: night.body, defs: night.defs }] }).svg)).not.toBeNull();
  });
  it('InkCircle — 한 번 그려지는 손그림 고리(무한 아님)', () => {
    expect(InkCircle(50, 50, 20)).toContain('class="k-ink"');
  });
});

describe('해·달', () => {
  it('서울 2026-10-12 해 뜸 6:36·짐 18:00 근처(±4분)', () => {
    const { rise, set } = sunTimes(OCT12);
    expect(Math.abs(rise - (6 * 60 + 36))).toBeLessThan(4);
    expect(Math.abs(set - 18 * 60)).toBeLessThan(4);
  });
  it('달 나이는 0~1', () => {
    const a = moonAge(Date.UTC(2026, 9, 12, 7));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
  });
});

describe('skinSwap — 바꿀 때만 두 겹', () => {
  it('처음·평소엔 한 겹, pick 뒤 첫 그림은 옛 층(leave) + 새 층, done 뒤 다시 한 겹', async () => {
    const { skinSwap } = await import('../../hq-template/.claude/skills/hq-mode-kit/kit-svg');
    const sw = skinSwap();
    const g = { skin: 'gauge' as const, w: 10, h: 10, body: 'g' }, c = { skin: 'cover' as const, w: 10, h: 10, body: 'c' };
    expect(sw.layers(g)).toEqual([g]);
    sw.pick();
    expect(sw.layers(c)).toEqual([{ ...g, leave: true }, c]);
    expect(sw.done()).toBe(true);
    expect(sw.layers(c)).toEqual([c]);
    expect(sw.done()).toBe(false);
  });
});

describe('층 CSS — 캐릭터 같은 제 움직임도 <style> 한 블록에', () => {
  it('layers 의 css 를 한 번씩만 같은 style 안에', () => {
    const css = '.k-ch .x{animation:k-x 1s infinite}@keyframes k-x{to{opacity:.5}}';
    const { svg } = svgDoc({ layers: [{ skin: 'cover', w: 10, h: 10, body: '', css, leave: true }, { skin: 'gauge', w: 10, h: 10, body: '', css }] });
    expect(svg.match(/<style>/g)).toHaveLength(1);
    expect(svg.split(css)).toHaveLength(2);
    expect(safeSvg(svg)).not.toBeNull();
  });
});
