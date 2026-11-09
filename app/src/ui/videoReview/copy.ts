// 영상 검토 화면 문구 — 소넷 medium(11-04). 부를 때 만든다(언어·붙은 컴퓨터는 켠 뒤에 정해진다)
import { machine, tr } from '../../i18n';

export const vrCopy = {
  placeholder: () => tr('여기에 말 남기기', 'Leave a note here'),
  empty: () => tr('아직 남긴 말이 없어요', 'No notes yet'),
  holdHint: () => tr('시간 바를 길게 누르면 그 근처가 펴져요', 'Press and hold the timeline to zoom in there'),
  preparing: (n: number) => tr(`${machine()}에서 폰용 영상 만드는 중 ${n}%`, `Making a phone version on ${machine()} ${n}%`),
  far: (size: string) => tr(`데이터 ${size}가 나가요. 볼까요?`, `This uses ${size} of data. Watch anyway?`),
  colTime: () => tr('시각', 'Time'),
  colNote: () => tr('남긴 말', 'Note'),
  sent: () => tr('보냈어요', 'Sent'),
  sendFail: () => tr('못 보냈어요', "Couldn't send"),
  openFail: () => tr('영상을 못 열었어요', "Couldn't open the video"),
  saveFail: () => tr('말을 저장하지 못했어요. 다시 시도할게요', "Couldn't save your note. Trying again"),
  gone: () => tr('지워졌어요', 'Deleted'),
  send: (name: string) => tr(`${name}에게 보내기`, `Send to ${name}`),
  play: () => tr('재생', 'Play'),
  pause: () => tr('멈춤', 'Pause'),
  del: () => tr('삭제', 'Delete'),
  edit: () => tr('수정', 'Edit'),
  close: () => tr('닫기', 'Close'),
  add: () => tr('추가', 'Add'),
  saveEdit: () => tr('수정 넣기', 'Save changes'),
  cancelEdit: () => tr('수정 그만두기', 'Cancel editing'),
  ruler: () => tr('시간 눈금', 'Timeline'),
  large: () => tr('크게', 'Enlarge'),
  restore: () => tr('원래 크기', 'Original size'),
};

/** 폰 팀 보관함 영상 — 맥이 받는 동안·실패 줄(소넷 medium, 11-04) */
export const teamVideoCopy = {
  fetching: (pct: number, size: string) => tr(`${machine()}에서 영상 받는 중 ${pct}% (${size})`, `${machine()} is downloading the video ${pct}% (${size})`),
  failNet: () => tr('연결이 끊겼어요. 다시 눌러 보세요', 'Connection lost. Tap to try again'),
  failDisk: () => tr(`${machine()} 저장 공간이 모자라요`, `Not enough storage on your ${machine()}`),
  failGone: () => tr('팀 보관함에서 지워졌어요', 'This file was deleted from the team locker'),
  failOther: () => tr('영상을 받지 못했어요', "Couldn't download the video"),
  retry: () => tr('다시 시도', 'Retry'),
};
