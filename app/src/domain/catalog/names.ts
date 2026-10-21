// 카탈로그 이름 = '<종류> — <이름>' (뽑기 화면은 ' — ' 앞을 떼고 보여 준다). 한·영 같은 모양. 팩 파일들도 이걸 쓴다
import { tr } from '../../i18n';

const named = (ko: string, en: string) => (k: string, e: string) => tr(`${ko} — ${k}`, `${en} — ${e}`);
export const skin = named('방 스킨', 'Room skin');
export const furn = named('가구', 'Furniture');
export const hat = named('캐릭터 꾸미기', 'Outfit');
export const view = named('창밖', 'Window view');
export const fx = named('펑 대신', 'Pop effect');
export const move = named('반장 액션', 'Boss move');
export const pal = named('펫 친구', 'Pet pal');
export const desk = named('책상 소품', 'Desk item');
export const title = named('칭호', 'Title');
export const light = named('조명', 'Lighting');
