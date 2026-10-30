// Subscription dashboard for the site owner (read-only).
// Password: the SAME admin password as the message-board admin page
// (SHA-256 hash in the shared D1 settings table, key
// admin_pass_hash). The password itself is never stored or shown
// here; only its hash is compared. No link to this page appears on
// the public site; the owner opens /api/admin directly.
import { escHtml, SUBSCRIPTIONS_DDL } from './ecpay/_common.js';

const RATE_DDL = 'CREATE TABLE IF NOT EXISTS admin_rate (ip TEXT PRIMARY KEY, cnt INTEGER DEFAULT 0, win INTEGER)';

function page(title, body) {
  return new Response(
    '<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + escHtml(title) + '</title>' +
      '<style>body{background:#17131f;color:#e6defa;font-family:sans-serif;max-width:720px;margin:0 auto;padding:32px 20px;line-height:1.8}' +
      'h1{color:#e8b54d;font-size:22px}a{color:#f5c86b}.box{border:1px solid #3a2f5c;border-radius:14px;padding:20px;background:#241e33}' +
      'table{border-collapse:collapse;width:100%;font-size:14px}th,td{border-bottom:1px solid #3a2f5c;padding:6px 8px;text-align:left}' +
      'input{padding:8px;border-radius:8px;border:1px solid #3a2f5c;background:#17131f;color:#e6defa}' +
      'button{background:#e8b54d;color:#17131f;border:none;border-radius:999px;padding:8px 20px;cursor:pointer}</style>' +
      '</head><body><div class="box"><h1>' + escHtml(title) + '</h1>' + body +
      '<p><a href="/">回 AI劇場首頁</a></p></div></body></html>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

function taipeiDate(ms) {
  const d = new Date(Number(ms) + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '/' + p(d.getUTCMonth() + 1) + '/' + p(d.getUTCDate());
}

async function sha256Hex(s) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestGet() {
  return page(
    '訂閱管理',
    '<p>請輸入管理密碼（與留言管理頁同一組）。</p>' +
      '<form method="post" action="/api/admin">' +
      '<input type="password" name="pw" autocomplete="current-password"> ' +
      '<button type="submit">查看</button></form>'
  );
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    if (!env.DB) return page('訂閱管理', '<p>資料庫尚未設定。</p>');
    const form = await request.formData();
    const pw = String(form.get('pw') || '');
    await env.DB.prepare(RATE_DDL).run();
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const now = Math.floor(Date.now() / 1000);
    const rate = await env.DB.prepare('SELECT cnt, win FROM admin_rate WHERE ip=?').bind(ip).first();
    if (rate && now - rate.win < 600 && rate.cnt >= 5) {
      return page('訂閱管理', '<p>嘗試次數過多，請 10 分鐘後再試。</p>');
    }
    if (rate && now - rate.win < 600) {
      await env.DB.prepare('UPDATE admin_rate SET cnt=cnt+1 WHERE ip=?').bind(ip).run();
    } else {
      await env.DB.prepare('INSERT OR REPLACE INTO admin_rate (ip, cnt, win) VALUES (?, 1, ?)').bind(ip, now).run();
    }
    const hashRow = await env.DB.prepare(
      "SELECT value FROM settings WHERE key='admin_pass_hash'"
    ).first();
    if (!hashRow) {
      return page('訂閱管理', '<p>尚未設定管理密碼，請先到留言管理頁設定管理密碼。</p>');
    }
    const expect = (await sha256Hex(pw)).toLowerCase();
    if (!hashRow.value || String(hashRow.value).toLowerCase() !== expect) {
      return page('訂閱管理', '<p>密碼錯誤。</p>');
    }
    await env.DB.prepare(SUBSCRIPTIONS_DDL).run();
    const counts = await env.DB.prepare(
      'SELECT status, COUNT(*) AS n FROM subscriptions GROUP BY status'
    ).all();
    const rows = await env.DB.prepare(
      'SELECT merchant_trade_no, status, amount, period_type, total_success_times, last_period_rtn, created_at FROM subscriptions ORDER BY created_at DESC LIMIT 50'
    ).all();
    const statusName = { active: '進行中', cancelled: '已取消', pending: '未付款', failed: '付款失敗' };
    const countText = (counts.results || [])
      .map((r) => (statusName[r.status] || r.status) + ' ' + r.n + ' 筆')
      .join('、');
    const tr = (rows.results || [])
      .map(
        (r) =>
          '<tr><td>' + escHtml(r.merchant_trade_no) + '</td><td>' + escHtml(statusName[r.status] || r.status) +
          '</td><td>' + escHtml(r.amount) + '（' + escHtml(r.period_type === 'Y' ? '年繳' : '月繳') +
          '）</td><td>' + escHtml(r.total_success_times) + '</td><td>' + escHtml(r.last_period_rtn || '') +
          '</td><td>' + escHtml(taipeiDate(r.created_at)) + '</td></tr>'
      )
      .join('');
    return page(
      '訂閱管理',
      '<p>' + escHtml(countText || '尚無訂閱紀錄') + '</p>' +
        '<table><tr><th>訂單編號</th><th>狀態</th><th>金額</th><th>成功次數</th><th>最近一期結果</th><th>建立日</th></tr>' +
        tr + '</table>' +
        '<p>此頁只供查看，不會顯示卡號資料；取消請客人自助或到綠界後台處理。</p>'
    );
  } catch (e) {
    return page('訂閱管理', '<p>系統忙碌中，請稍後再試。</p>');
  }
}
