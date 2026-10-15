// 시험용 — README 안내 글을 읽는다. 원본은 public/README*.md, 공개본은 export 가 public/ 을 맨 위로 올려 README*.md 라서
// 고정 경로 ?raw 로는 한쪽에서 깨진다(0.3.0 공개본 vitest). 둘 다 훑어 있는 쪽을 쓰고, 없으면 시험이 조용히 비지 않게 던진다
const found = import.meta.glob(['../../../public/README*.md', '../../../README*.md'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

function pick(name: string): string {
  const hit = Object.entries(found).find(([p]) => p.endsWith(`/${name}`));
  if (!hit) throw new Error(`${name} 를 못 찾았다 — public/ 이나 저장소 맨 위에 있어야 한다`);
  return hit[1];
}

export const readmeKo = pick('README.ko.md');
export const readmeEn = pick('README.md');
