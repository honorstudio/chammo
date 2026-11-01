// 글 파일을 못 읽었을 때 한 줄 — UTF-8 이 아닌 글(엑셀 CSV·옛 메모장)은 내부 코드(NOT_UTF8) 대신 사람 말 + 기본 앱으로 열기(11-01 QA H11)
import { openTarget } from '../../data/tauri';
import { notUtf8 } from '../../domain/reader';
import { tr } from '../../i18n';
import { IconOpen } from '../Icons';
import { IconButton } from '../kit/IconButton';

export function ReadFail({ path, err, className }: { path: string; err: string; className: string }) {
  if (!notUtf8(err)) return <div className={className}>{tr('못 읽었어', "Couldn't read it")} — {err}</div>;
  return (
    // 한 덩어리(span) 안에 줄바꿈 — 리더의 rd-empty 는 가로 flex 라 글과 단추가 옆으로 붙었다. 여는 건 익숙한 동작이라 아이콘(이름은 label)
    <div className={className}>
      <span>
        {tr('이 파일은 Chammo에서 보여 줄 수 없는 글자 형식으로 되어 있어요. 기본 앱으로 열면 내용을 볼 수 있어요.', "This file uses a text format Chammo can't display. You can still read it by opening it in your default app.")}
        <br />
        <IconButton size="l" tone="line" label={tr('기본 앱으로 열기', 'Open in default app')} onClick={() => void openTarget('file', path).catch(() => {})}><IconOpen /></IconButton>
      </span>
    </div>
  );
}
