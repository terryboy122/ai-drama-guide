// Self-serve subscription status lookup (read-only).
// The visitor proves nothing beyond the order number itself, so this
// returns only the status wording: never amounts, card digits, or
// other order details. Same per-IP attempt limit as cancel.
import { SUBSCRIPTIONS_DDL } from './ecpay/_common.js';

const RATE_DDL = 'CREATE TABLE IF NOT EXISTS status_rate (ip TEXT PRIMARY KEY, cnt INTEGER DEFAULT 0, win INTEGER)';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const STATUS_TEXT = {
  active: '這筆訂閱進行中。',
  cancelled: '這筆訂閱已取消，下個週期起不再扣款。',
  pending: '這筆訂單尚未完成付款，沒有進行中的定期扣款。',
  failed: '這筆訂單付款失敗，沒有進行中的定期扣款。',
};

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    if (!env.DB) return json({ ok: false, message: '資料庫尚未設定，請透過留言板聯絡站主。' }, 500);
    let body = {};
    try {
      body = await request.json();
    } catch (e) {
      return json({ ok: false, message: '資料格式錯誤。' }, 400);
    }
    const tradeNo = String(body.tradeNo || '').trim().toUpperCase();
    if (!/^SUB[0-9A-Z]{17}$/.test(tradeNo)) {
      return json({ ok: false, message: '訂單編號格式不正確，請再檢查一次。' }, 400);
    }
    await env.DB.prepare(SUBSCRIPTIONS_DDL).run();
    await env.DB.prepare(RATE_DDL).run();
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const now = Math.floor(Date.now() / 1000);
    const rate = await env.DB.prepare('SELECT cnt, win FROM status_rate WHERE ip=?').bind(ip).first();
    if (rate && now - rate.win < 600 && rate.cnt >= 5) {
      return json({ ok: false, message: '查詢次數過多，請 10 分鐘後再試。' }, 429);
    }
    if (rate && now - rate.win < 600) {
      await env.DB.prepare('UPDATE status_rate SET cnt=cnt+1 WHERE ip=?').bind(ip).run();
    } else {
      await env.DB.prepare('INSERT OR REPLACE INTO status_rate (ip, cnt, win) VALUES (?, 1, ?)').bind(ip, now).run();
    }
    const row = await env.DB.prepare(
      'SELECT status FROM subscriptions WHERE merchant_trade_no=?'
    )
      .bind(tradeNo)
      .first();
    if (!row) return json({ ok: false, message: '查無此訂單編號，請再檢查一次。' }, 404);
    return json({ ok: true, message: STATUS_TEXT[row.status] || '這筆訂閱狀態：' + row.status });
  } catch (e) {
    return json({ ok: false, message: '查詢失敗，請稍後再試。' }, 500);
  }
}
