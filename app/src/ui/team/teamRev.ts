// 팀 판 바뀜 묻기 묶음 하나(domain/teamRevWatch) — 이 창의 프로필판·글판·홈판이 같이 쓴다. 창마다(메인·메신저 창) 따로라 판이 섞이지 않는다
import { teamProfileChanged } from '../../data/teamProfileApi';
import { makeRevWatch } from '../../domain/teamRevWatch';
import { every } from '../poll';

export const teamRev = makeRevWatch(teamProfileChanged, every);
