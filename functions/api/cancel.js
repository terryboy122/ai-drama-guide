// Self-serve subscription cancellation.
// The visitor proves ownership with the order number (shown on the
// success page) plus the last 4 digits of the card they paid with.
// Then this calls ECPay's CreditCardPeriodAction with Action=Cancel;
// a cancelled schedule cannot be reactivated, so the visitor must
// subscribe again to resume support.
import { checkMacValue, SUBSCRIPTIONS_DDL, CANCEL_RATE_DDL } from './ecpay/_common.js';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    if (!env.DB) return json({ ok: false, message: '資料庫尚未設定，請透過留言板聯絡站主。' }, 500);
    if (!env.ECPAY_MERCHANT_ID || !env.ECPAY_HASH_KEY || !env.ECPAY_HASH_IV) {
      return json({ ok: false, message: '金流參數尚未設定，請透過留言板聯絡站主。' }, 500);
    }
    let body = {};
    try {
      body = await request.json();
    } catch (e) {
      return json({ ok: false, message: '資料格式錯誤。' }, 400);
    }
    const tradeNo = String(body.tradeNo || '').trim().toUpperCase();
    const card4 = String(body.card4 || '').trim();
    if (!/^SUB[0-9A-Z]{17}$/.test(tradeNo) || !/^\d{4}$/.test(card4)) {
      return json({ ok: false, message: '訂單編號或信用卡末四碼格式不正確，請再檢查一次。' }, 400);
    }

    await env.DB.prepare(SUBSCRIPTIONS_DDL).run();
    await env.DB.prepare(CANCEL_RATE_DDL).run();
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const now = Math.floor(Date.now() / 1000);
    const rate = await env.DB.prepare('SELECT cnt, win FROM cancel_rate WHERE ip=?').bind(ip).first();
    if (rate && now - rate.win < 600 && rate.cnt >= 5) {
      return json({ ok: false, message: '嘗試次數過多，請 10 分鐘後再試，或透過留言板聯絡站主。' }, 429);
    }
    if (rate && now - rate.win < 600) {
      await env.DB.prepare('UPDATE cancel_rate SET cnt=cnt+1 WHERE ip=?').bind(ip).run();
    } else {
      await env.DB.prepare('INSERT OR REPLACE INTO cancel_rate (ip, cnt, win) VALUES (?, 1, ?)').bind(ip, now).run();
    }

    const row = await env.DB.prepare(
      'SELECT status, card4 FROM subscriptions WHERE merchant_trade_no=?'
    )
      .bind(tradeNo)
      .first();
    if (!row) return json({ ok: false, message: '查無此訂單編號，請再檢查一次。' }, 404);
    if (row.status === 'cancelled') {
      return json({ ok: true, message: '這筆訂閱已經取消過了，下個月起不再扣款。' });
    }
    if (row.status !== 'active') {
      return json({ ok: false, message: '這筆訂單沒有進行中的定期扣款，不需要取消；如有疑問請透過留言板聯絡站主。' });
    }
    if (!row.card4) {
      return json({ ok: false, message: '這筆訂單沒有卡號末四碼紀錄，請透過留言板聯絡站主取消。' });
    }
    if (row.card4 !== card4) {
      return json({ ok: false, message: '信用卡末四碼不符，請再檢查一次。' }, 403);
    }

    const params = {
      MerchantID: env.ECPAY_MERCHANT_ID,
      MerchantTradeNo: tradeNo,
      Action: 'Cancel',
      TimeStamp: String(now),
    };
    params.CheckMacValue = await checkMacValue(params, env.ECPAY_HASH_KEY, env.ECPAY_HASH_IV);
    const url =
      env.ECPAY_ENV === 'prod'
        ? 'https://payment.ecpay.com.tw/Cashier/CreditCardPeriodAction'
        : 'https://payment-stage.ecpay.com.tw/Cashier/CreditCardPeriodAction';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    const text = await res.text();
    const resp = Object.fromEntries(new URLSearchParams(text));
    if (resp.CheckMacValue) {
      const expect = await checkMacValue(resp, env.ECPAY_HASH_KEY, env.ECPAY_HASH_IV);
      if (expect !== resp.CheckMacValue) {
        return json({ ok: false, message: '綠界回覆驗證失敗，請透過留言板聯絡站主。' }, 502);
      }
    }
    if (resp.RtnCode !== '1') {
      return json({ ok: false, message: '綠界回覆：' + (resp.RtnMsg || '取消失敗') + '。請透過留言板聯絡站主。' }, 502);
    }
    await env.DB.prepare('UPDATE subscriptions SET status=?, updated_at=? WHERE merchant_trade_no=?')
      .bind('cancelled', Date.now(), tradeNo)
      .run();
    return json({ ok: true, message: '已取消訂閱，下個月起不再扣款。謝謝你曾經的支持；若想恢復支持，請重新訂閱。' });
  } catch (e) {
    return json({ ok: false, message: '取消失敗，請稍後再試或透過留言板聯絡站主。' }, 500);
  }
}
