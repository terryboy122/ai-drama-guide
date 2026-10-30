// ECPay client-side payment result (OrderResultURL).
// This page is only what the visitor sees; the server-side notify
// (ReturnURL) is authoritative for the subscription record.
import { checkMacValue, escHtml } from './_common.js';

function page(title, body) {
  return new Response(
    '<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + escHtml(title) + '</title>' +
      '<style>body{background:#17131f;color:#e6defa;font-family:sans-serif;max-width:640px;margin:0 auto;padding:32px 20px;line-height:1.8}' +
      'h1{color:#e8b54d;font-size:22px}a{color:#f5c86b}.box{border:1px solid #3a2f5c;border-radius:14px;padding:20px;background:#241e33}</style>' +
      '</head><body><div class="box"><h1>' + escHtml(title) + '</h1>' + body +
      '<p><a href="/">回 AI劇場首頁</a></p></div></body></html>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const form = await request.formData();
    const params = {};
    form.forEach((v, k) => {
      params[k] = v;
    });
    const tradeNo = params.MerchantTradeNo || '';
    const expect = await checkMacValue(params, env.ECPAY_HASH_KEY, env.ECPAY_HASH_IV);
    if (!params.CheckMacValue || expect !== params.CheckMacValue) {
      return page(
        '付款結果確認中',
        '<p>已收到付款結果，正在確認中，請稍後再回來查看。</p>' +
          (tradeNo ? '<p>訂單編號：' + escHtml(tradeNo) + '</p>' : '')
      );
    }
    if (params.RtnCode === '1') {
      return page(
        '訂閱成功，謝謝你的支持！',
        '<p>每月 39 元的贊助訂閱已成立，之後每月會自動扣款。</p>' +
          '<p>訂單編號：<b>' + escHtml(tradeNo) + '</b>（想取消訂閱時，請到首頁贊助訂閱區填寫此編號與信用卡末四碼自助取消，或透過留言板聯絡站主；取消後無法恢復、需重新訂閱才會再扣款，下個月起不再扣款。）</p>' +
          '<script>try{localStorage.setItem("aidrama_subscribed","1");}catch(e){}</script>'
      );
    }
    return page(
      '付款未完成',
      '<p>這筆訂閱沒有完成付款，請回首頁重新訂閱，或透過留言板聯絡站主。</p>' +
        (tradeNo ? '<p>訂單編號：' + escHtml(tradeNo) + '</p>' : '')
    );
  } catch (e) {
    return page('付款結果確認中', '<p>系統忙碌中，請稍後再回來查看。</p>');
  }
}
