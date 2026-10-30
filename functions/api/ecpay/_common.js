// Shared ECPay CheckMacValue helpers (SHA256).
// Algorithm (ECPay official): exclude CheckMacValue, sort keys
// case-insensitively A-Z, join k=v with &, sandwich with
// HashKey=...& and &HashIV=..., ECPay URL-encode, SHA256, uppercase.
// ECPay URL-encode: percent-encode, lowercase everything, then .NET
// replacements (%2d->-, %5f->_, %2e->., %21->!, %2a->*, %28->(,
// %29->), %20->+). Verified against ECPay's worked example:
// MerchantID=3002607, ItemName="Tom's Shop", TotalAmount=100
// -> hashkey%3dpwfhcqoqzgmho4w6%26itemname%3dtom%27s+shop
//    %26merchantid%3d3002607%26totalamount%3d100
//    %26hashiv%3dekrm7ift261dpevs
export function ecpayUrlEncode(s) {
  let e = encodeURIComponent(s)
    .replace(/%20/g, '+')
    .replace(/~/g, '%7e')
    .replace(/'/g, '%27');
  e = e.toLowerCase();
  e = e
    .replace(/%2d/g, '-')
    .replace(/%5f/g, '_')
    .replace(/%2e/g, '.')
    .replace(/%21/g, '!')
    .replace(/%2a/g, '*')
    .replace(/%28/g, '(')
    .replace(/%29/g, ')');
  return e;
}

export async function checkMacValue(params, hashKey, hashIv) {
  const filtered = Object.entries(params).filter(([k]) => k !== 'CheckMacValue');
  filtered.sort((a, b) => {
    const x = a[0].toLowerCase();
    const y = b[0].toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const raw =
    'HashKey=' +
    hashKey +
    '&' +
    filtered.map(([k, v]) => k + '=' + v).join('&') +
    '&HashIV=' +
    hashIv;
  const encoded = ecpayUrlEncode(raw);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encoded));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

export function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const SUBSCRIPTIONS_DDL =
  'CREATE TABLE IF NOT EXISTS subscriptions (merchant_trade_no TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT \'pending\', amount INTEGER NOT NULL DEFAULT 39, period_type TEXT DEFAULT \'M\', frequency INTEGER DEFAULT 1, exec_times INTEGER DEFAULT 999, ecpay_trade_no TEXT, rtn_code TEXT, total_success_times INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER, last_period_at INTEGER, last_period_rtn TEXT)';
