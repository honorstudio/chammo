// 가짜 폰 서버 — /api/default-model 만(Rust mobile_http 와 같은 검사). window.__posts 로 저장을 본다
import type { DefaultModelView } from '../../src/domain/defaultModel';

const w = window as unknown as { __posts: unknown[]; __dm: DefaultModelView | null };
w.__posts = [];
const MODELS = ['opus', 'sonnet', 'haiku', 'fable'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const readDefaultModel = async () => { if (!w.__dm) throw new Error('404'); return { ...w.__dm }; };
export const setDefaultModel = async (model: string, effort: string) => {
  w.__posts.push({ model, effort });
  if ((model && !MODELS.includes(model)) || (effort && !EFFORTS.includes(effort))) throw new Error('400');
  w.__dm = { ...w.__dm!, model, effort };
  return { ...w.__dm };
};
