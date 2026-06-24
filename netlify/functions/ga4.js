/**
 * ga4.js — Netlify Serverless Function
 * Consulta a GA4 Data API.
 *
 * Autenticação em ordem de prioridade:
 *   1. Service Account (recomendado — sem expiração)
 *      GA4_SA_EMAIL        → e-mail da service account
 *      GA4_SA_PRIVATE_KEY  → chave privada (conteúdo completo do campo "private_key" do JSON)
 *
 *   2. OAuth2 Refresh Token (fallback)
 *      GA4_CLIENT_ID / GA4_CLIENT_SECRET / GA4_REFRESH_TOKEN
 *
 *   Sempre necessário:
 *      GA4_PROPERTY_ID → ID numérico da propriedade GA4
 */

const crypto    = require('crypto');
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GA4_URL   = 'https://analyticsdata.googleapis.com/v1beta';
const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

// ── Service Account JWT ────────────────────────────────────────────────────────
async function getServiceAccountToken(email, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const b64  = s => Buffer.from(s).toString('base64url');
  const header  = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64(JSON.stringify({
    iss: email, scope: GA4_SCOPE,
    aud: TOKEN_URL, exp: now + 3600, iat: now
  }));
  const sigInput = `${header}.${payload}`;
  // A chave pode vir com \n literal ou com quebras reais
  const key = privateKey.replace(/\\n/g, '\n');
  const sig  = crypto.createSign('RSA-SHA256').update(sigInput).sign(key, 'base64url');
  const jwt  = `${sigInput}.${sig}`;

  const res  = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('SA token error: ' + JSON.stringify(data));
  return data.access_token;
}

// ── OAuth2 Refresh Token ───────────────────────────────────────────────────────
async function getRefreshToken(clientId, clientSecret, refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken
    })
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token error: ' + JSON.stringify(data));
  return data.access_token;
}

// ── GA4 API ────────────────────────────────────────────────────────────────────
async function batchRun(token, propId, requests) {
  const res = await fetch(`${GA4_URL}/properties/${propId}:batchRunReports`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests })
  });
  if (!res.ok) throw new Error(`GA4 API ${res.status}: ${await res.text()}`);
  return res.json();
}

function rows(report) {
  if (!report?.rows) return [];
  return report.rows.map(r => ({
    dim:  (r.dimensionValues || []).map(d => d.value),
    vals: (r.metricValues   || []).map(m => parseFloat(m.value || 0))
  }));
}

// ── Handler ────────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, max-age=900'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const propertyId = process.env.GA4_PROPERTY_ID;
  if (!propertyId) {
    return { statusCode: 200, headers, body: JSON.stringify({ status: 'GA4_NOT_CONFIGURED', message: 'GA4_PROPERTY_ID não definido.' }) };
  }

  try {
    // Tenta Service Account primeiro, depois refresh token
    let token;
    const saEmail = process.env.GA4_SA_EMAIL;
    const saKey   = process.env.GA4_SA_PRIVATE_KEY;

    if (saEmail && saKey) {
      token = await getServiceAccountToken(saEmail, saKey);
    } else {
      const clientId     = process.env.GA4_CLIENT_ID;
      const clientSecret = process.env.GA4_CLIENT_SECRET;
      const refreshToken = process.env.GA4_REFRESH_TOKEN;
      if (!clientId || !clientSecret || !refreshToken) {
        return { statusCode: 200, headers, body: JSON.stringify({ status: 'GA4_NOT_CONFIGURED', message: 'Configure GA4_SA_EMAIL + GA4_SA_PRIVATE_KEY (recomendado) ou GA4_CLIENT_ID + GA4_CLIENT_SECRET + GA4_REFRESH_TOKEN.' }) };
      }
      token = await getRefreshToken(clientId, clientSecret, refreshToken);
    }

    const { startDate = '30daysAgo', endDate = 'today' } = event.queryStringParameters || {};
    const dateRanges = [{ startDate, endDate }];

    const b1 = await batchRun(token, propertyId, [
      { dateRanges, metrics: [
        { name: 'sessions' }, { name: 'totalUsers' }, { name: 'screenPageViews' },
        { name: 'averageSessionDuration' }, { name: 'bounceRate' }, { name: 'newUsers' }
      ]},
      { dateRanges, dimensions: [{ name: 'date' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'screenPageViews' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }], limit: 90 },
      { dateRanges, dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'screenPageViews' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: 8 },
      { dateRanges, dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 8 },
      { dateRanges, dimensions: [{ name: 'deviceCategory' }], metrics: [{ name: 'sessions' }] }
    ]);

    const b2 = await batchRun(token, propertyId, [
      { dateRanges, dimensions: [{ name: 'userGender' }],    metrics: [{ name: 'totalUsers' }] },
      { dateRanges, dimensions: [{ name: 'userAgeBracket' }],metrics: [{ name: 'totalUsers' }] },
      { dateRanges, dimensions: [{ name: 'region' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 12 },
      { dateRanges, dimensions: [{ name: 'city' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 10 },
      { dateRanges, dimensions: [{ name: 'newVsReturning' }], metrics: [{ name: 'sessions' }] }
    ]);

    const b3 = await batchRun(token, propertyId, [
      { dateRanges, dimensions: [{ name: 'browser' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 8 },
      { dateRanges, dimensions: [{ name: 'operatingSystem' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 6 },
      { dateRanges, dimensions: [{ name: 'hour' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ dimension: { dimensionName: 'hour' } }], limit: 24 },
      { dateRanges, dimensions: [{ name: 'dayOfWeek' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ dimension: { dimensionName: 'dayOfWeek' } }] }
    ]);

    const kpiRow = b1.reports?.[0]?.rows?.[0];
    const kpis = {
      sessions:    parseFloat(kpiRow?.metricValues?.[0]?.value || 0),
      users:       parseFloat(kpiRow?.metricValues?.[1]?.value || 0),
      pageViews:   parseFloat(kpiRow?.metricValues?.[2]?.value || 0),
      avgDuration: parseFloat(kpiRow?.metricValues?.[3]?.value || 0),
      bounceRate:  parseFloat(kpiRow?.metricValues?.[4]?.value || 0),
      newUsers:    parseFloat(kpiRow?.metricValues?.[5]?.value || 0)
    };

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        status: 'ok', period: { startDate, endDate }, kpis,
        timeline:       rows(b1.reports?.[1]),
        pages:          rows(b1.reports?.[2]),
        sources:        rows(b1.reports?.[3]),
        devices:        rows(b1.reports?.[4]),
        gender:         rows(b2.reports?.[0]),
        age:            rows(b2.reports?.[1]),
        states:         rows(b2.reports?.[2]),
        cities:         rows(b2.reports?.[3]),
        newVsReturning: rows(b2.reports?.[4]),
        browsers:       rows(b3.reports?.[0]),
        os:             rows(b3.reports?.[1]),
        hours:          rows(b3.reports?.[2]),
        weekdays:       rows(b3.reports?.[3])
      })
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ status: 'error', message: err.message }) };
  }
};
