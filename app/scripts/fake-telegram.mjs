#!/usr/bin/env node
// 가짜 텔레그램 봇 API(시험용, 127.0.0.1 만) — 개발판을 CHAMMO_TELEGRAM_API=http://127.0.0.1:<포트> 로 띄워 메신저 브리지를 끝까지 잰다.
// 봇 쪽: getMe·getWebhookInfo·getUpdates(롱폴링·offset)·sendMessage·sendChatAction·answerCallbackQuery·editMessageReplyMarkup
// 사람 쪽(조종): POST /_ctl/say {from,text,date?} · /_ctl/press {from,data,msg?} · /_ctl/refuse {code} · GET /_ctl/log · /_ctl/updates
// 쓰기: node app/scripts/fake-telegram.mjs [포트=47130] [토큰]
import http from 'node:http';

const PORT = Number(process.argv[2] || 47130);
const TOKEN = process.argv[3] || '123456789:AAH4kq9_sZx-Qw3eRtYuIoP1aSdFgHjKlZx';
const BOT = { id: 1, is_bot: true, first_name: 'Chammo 시험', username: 'chammo_fake_bot' };

const updates = [];
const calls = [];
let nextUpdate = 100;
let nextMsg = 1;
let refuse = null;
const waiters = [];

function push(u) {
  u.update_id = nextUpdate++;
  updates.push(u);
  for (const w of waiters.splice(0)) w();
}

const user = (id) => ({ id: Number(id), is_bot: false, first_name: id === 7001 || id === '7001' ? '길동' : '모르는사람' });

function reply(res, code, body) {
  const b = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) });
  res.end(b);
}

const ok = (result) => ({ ok: true, result });

async function bodyOf(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const t = Buffer.concat(chunks).toString('utf8');
  try { return t ? JSON.parse(t) : {}; } catch { return { _raw: t }; }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const body = await bodyOf(req);
  if (url.pathname.startsWith('/_ctl/')) {
    const what = url.pathname.slice(6);
    if (what === 'say') {
      const from = Number(body.from);
      push({ message: { message_id: nextMsg++, date: body.date ?? Math.floor(Date.now() / 1000), chat: { id: body.chat ?? from, type: body.type ?? 'private' }, from: user(from), text: body.text } });
      return reply(res, 200, { ok: true });
    }
    if (what === 'press') {
      const from = Number(body.from);
      push({ callback_query: { id: `cb${nextUpdate}`, from: user(from), message: { message_id: body.msg ?? 1, chat: { id: from, type: 'private' } }, data: body.data } });
      return reply(res, 200, { ok: true });
    }
    if (what === 'refuse') { refuse = Number(body.code); return reply(res, 200, { ok: true }); }
    if (what === 'log') return reply(res, 200, calls);
    if (what === 'updates') return reply(res, 200, updates);
    return reply(res, 404, { ok: false });
  }
  const m = url.pathname.match(/^\/bot([^/]+)\/([A-Za-z]+)$/);
  if (!m) return reply(res, 404, { ok: false, error_code: 404, description: 'Not Found' });
  if (m[1] !== TOKEN) return reply(res, 401, { ok: false, error_code: 401, description: 'Unauthorized' });
  const method = m[2];
  calls.push({ at: Date.now(), method, body });
  switch (method) {
    case 'getMe': return reply(res, 200, ok(BOT));
    case 'getWebhookInfo': return reply(res, 200, ok({ url: '' }));
    case 'getUpdates': {
      if (refuse) { const c = refuse; refuse = null; return reply(res, c, { ok: false, error_code: c, description: c === 409 ? 'Conflict: terminated by other getUpdates request' : 'Too Many Requests', parameters: { retry_after: 3 } }); }
      const off = Number(body.offset || 0);
      const pick = () => updates.filter((u) => u.update_id >= off);
      const deadline = Date.now() + Math.min(Number(body.timeout || 0), 30) * 1000;
      while (pick().length === 0 && Date.now() < deadline) {
        await new Promise((r) => { const t = setTimeout(r, deadline - Date.now()); waiters.push(() => { clearTimeout(t); r(); }); });
      }
      return reply(res, 200, ok(pick().slice(0, 100)));
    }
    case 'sendMessage': return reply(res, 200, ok({ message_id: nextMsg++, chat: { id: body.chat_id }, text: body.text }));
    default: return reply(res, 200, ok(true));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`fake telegram on http://127.0.0.1:${PORT}`));
