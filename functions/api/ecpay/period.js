// ECPay per-period charge notification (PeriodReturnURL).
// Verifies CheckMacValue, records the period result, replies 1|OK.
import { checkMacValue, SUBSCRIPTIONS_DDL } from './_common.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const form = await request.formData();
    const params = {};
    form.forEach((v, k) => {
      params[k] = v;
    });
    const expect = await checkMacValue(params, env.ECPAY_HASH_KEY, env.ECPAY_HASH_IV);
    if (!params.CheckMacValue || expect !== params.CheckMacValue) {
      return new Response('驗證失敗', { status: 400 });
    }
    if (env.DB) {
      await env.DB.prepare(SUBSCRIPTIONS_DDL).run();
      await env.DB.prepare(
        'UPDATE subscriptions SET total_success_times=?, last_period_at=?, last_period_rtn=?, updated_at=? WHERE merchant_trade_no=?'
      )
        .bind(
          parseInt(params.TotalSuccessTimes || '0', 10) || 0,
          Date.now(),
          params.RtnCode || '',
          Date.now(),
          params.MerchantTradeNo
        )
        .run();
    }
    return new Response('1|OK', { headers: { 'Content-Type': 'text/plain' } });
  } catch (e) {
    return new Response('處理失敗', { status: 500 });
  }
}
