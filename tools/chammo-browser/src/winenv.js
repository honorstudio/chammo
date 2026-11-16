// 윈도우 env 이름은 대소문자를 안 가린다 — process.env 자체는 그렇게 읽히지만 {...process.env} 사본·시험용 객체는 평범한 객체라
// 'ProgramFiles' 로 물으면 'PROGRAMFILES'(Git Bash 등이 바꿔 넘긴 모양)를 못 찾았다(공개 이슈 #28).
// 같은 이름이 있으면 그것, 없으면 대소문자 무시로 처음 맞는 것

/** env[key] — 같은 이름 먼저, 없으면 대소문자 무시. 없으면 undefined */
function envGet(env, key) {
  if (!env) return undefined;
  if (env[key] !== undefined) return env[key];
  const low = key.toLowerCase();
  const k = Object.keys(env).find((x) => x.toLowerCase() === low);
  return k === undefined ? undefined : env[k];
}

module.exports = { envGet };
