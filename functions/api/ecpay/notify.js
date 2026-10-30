// ECPay server-side first-charge notification (ReturnURL).
// Verifies CheckMacValue, marks the subscription active/failed,
// and replies 1|OK so ECPay stops retrying.
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
      if (params.RtnCode === '1') {
        await env.DB.prepare(
          'UPDATE subscriptions SET status=?, ecpay_trade_no=?, rtn_code=?, updated_at=? WHERE merchant_trade_no=?'
        )
          .bind('active', params.TradeNo || '', '1', Date.now(), params.MerchantTradeNo)
          .run();
      } else {
        await env.DB.prepare(
          'UPDATE subscriptions SET status=?, rtn_code=?, updated_at=? WHERE merchant_trade_no=?'
        )
          .bind('failed', params.RtnCode || '', Date.now(), params.MerchantTradeNo)
          .run();
      }
    }
    return new Response('1|OK', { headers: { 'Content-Type': 'text/plain' } });
  } catch (e) {
    return new Response('處理失敗', { status: 500 });
  }
}
