// Create an ECPay credit-card periodic (subscription) order for the
// ai-drama-guide site: NT$39/month or NT$390/year, auto-charged by
// ECPay. Plan comes from ?plan=monthly (default) or ?plan=yearly.
// GET and POST both return an auto-submit form to ECPay's checkout
// page (GET exists so the flow can be tested directly in a browser).
// The public subscribe button stays disabled until production keys
// replace the stage credentials, so no visitor can reach this early.
// Stage uses the general test merchant (2000132): its published key
// pair validates on current Stage, unlike the older 2000214 pair
// (CheckMacValue error on 2026-10-30). SMS-step issues are bypassed
// via the vendor-stage backend simulate-payment function.
import { checkMacValue, escHtml, SUBSCRIPTIONS_DDL } from './ecpay/_common.js';

const SITE = 'https://ai-drama-guide.pages.dev';

const PLANS = {
  monthly: { amount: 39, periodType: 'M', item: 'AI劇場贊助訂閱每月39元', cycle: '每月' },
  yearly: { amount: 390, periodType: 'Y', item: 'AI劇場贊助訂閱每年390元', cycle: '每年' },
};

function taipeiNow() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear() + '/' + p(d.getUTCMonth() + 1) + '/' + p(d.getUTCDate()) +
    ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds())
  );
}

function taipeiDigits() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return (
    String(d.getUTCFullYear()) + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) +
    p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds())
  );
}

export async function onRequest(context) {
  const { request, env } = context;
  const planKey = new URL(request.url).searchParams.get('plan') === 'yearly' ? 'yearly' : 'monthly';
  const plan = PLANS[planKey];
  const mid = env.ECPAY_MERCHANT_ID;
  const hk = env.ECPAY_HASH_KEY;
  const hiv = env.ECPAY_HASH_IV;
  if (!mid || !hk || !hiv) {
    return new Response('金流參數尚未設定', { status: 500 });
  }
  const action =
    env.ECPAY_ENV === 'prod'
      ? 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5'
      : 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5';
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let rnd = '';
  for (let i = 0; i < 3; i++) rnd += chars[Math.floor(Math.random() * chars.length)];
  const tradeNo = 'SUB' + taipeiDigits() + rnd; // 3 + 14 + 3 = 20 chars
  const params = {
    MerchantID: mid,
    MerchantTradeNo: tradeNo,
    MerchantTradeDate: taipeiNow(),
    PaymentType: 'aio',
    TotalAmount: String(plan.amount),
    TradeDesc: 'AI劇場贊助訂閱',
    ItemName: plan.item,
    ReturnURL: SITE + '/api/ecpay/notify',
    OrderResultURL: SITE + '/api/ecpay/result',
    ClientBackURL: SITE + '/',
    ChoosePayment: 'Credit',
    EncryptType: '1',
    PeriodAmount: String(plan.amount),
    PeriodType: plan.periodType,
    Frequency: '1',
    ExecTimes: '999',
    PeriodReturnURL: SITE + '/api/ecpay/period',
    NeedExtraPaidInfo: 'Y',
    CustomField1: 'ai-drama-guide',
  };
  params.CheckMacValue = await checkMacValue(params, hk, hiv);
  if (!env.DB) return new Response('資料庫尚未設定', { status: 500 });
  try {
    await env.DB.prepare(SUBSCRIPTIONS_DDL).run();
    await env.DB.prepare(
      'INSERT INTO subscriptions (merchant_trade_no, status, amount, period_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(tradeNo, 'pending', plan.amount, plan.periodType, Date.now(), Date.now())
      .run();
  } catch (e) {
    return new Response('訂單建立失敗', { status: 500 });
  }
  const inputs = Object.entries(params)
    .map(([k, v]) => '<input type="hidden" name="' + escHtml(k) + '" value="' + escHtml(v) + '">')
    .join('\n');
  const html =
    '<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><title>前往綠界付款</title></head>' +
    '<body><p>正在前往綠界刷卡授權頁……</p>' +
    '<form id="f" method="post" action="' + escHtml(action) + '">' + inputs + '</form>' +
    '<script>document.getElementById("f").submit();</script></body></html>';
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
