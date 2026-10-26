// 팀 만들기·초대받기 팝업(TeamStart) 화면 고르기 — 링크로 앱이 열렸을 때(딥링크, ADR 0015)도 같은 판단
// login = 계정 로그인부터(끝나면 같은 팝업에서 이어서) · make = 팀 만들기(+ '초대받았어요') · join = 받은 초대 붙여 넣기
// invite = 초대 링크 만들기(+ '초대받았어요') · already = 계정 없이 초대 코드로 들어온 옛 기기가 또 초대받음(그 기기만 팀 하나)
// 계정 기기는 팀이 있어도 다른 팀 초대를 받는다(team_relay register — 여러 팀)
// loading = 팀 상태를 아직 못 읽음(링크로 앱이 막 켜졌을 때 — 로그인 화면이 번쩍이다 바뀌지 않게)
export type StartScreen = 'loading' | 'login' | 'make' | 'join' | 'invite' | 'already';

export function startScreen(v: { joined: boolean; account: unknown } | null, o: { invite: string; wantJoin: boolean }): StartScreen {
  if (!v) return 'loading';
  if (v.joined && !v.account) return o.invite || o.wantJoin ? 'already' : 'invite';
  if (v.joined) return o.invite || o.wantJoin ? 'join' : 'invite';
  if (!v.account) return 'login';
  return o.invite || o.wantJoin ? 'join' : 'make';
}
