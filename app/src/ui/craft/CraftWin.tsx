// Craft 맥 앱 따로 창(craft.html) — 스페이스 탭과 같은 칸(CraftPane)을 창 하나에
import { CraftPane } from './CraftPane';

export const CraftWin = ({ app }: { app: string }) => <CraftPane app={app} place="window" />;
