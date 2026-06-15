/**
 * ga4.js — Netlify Serverless Function
 * Consulta a GA4 Data API usando OAuth2 Refresh Token
 *
 * Variáveis de ambiente necessárias no Netlify:
 *   GA4_CLIENT_ID      → OAuth2 Client ID
 *   GA4_CLIENT_SECRET  → OAuth2 Client Secret
 *   GA4_REFRESH_TOKEN  → OAuth2 Refresh Token
 *   GA4_PROPERTY_ID    → ID numérico da propriedade GA4 (ex: 540434072)
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GA4_URL   = 'https://analyticsdata.googleapis.com/v1beta';

// ── OAuth2 Refresh Token ───────────────────────────────────────────────────────
async function getToken(clientId, clientSecret, refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken
    }).toString()
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token error: ' + JSON.stringify(data));
  return data.access_token;
}

// ── GA4 API calls ─────────────────────────────────────────────────────────────
async function batchRun(token, propId, requests) {
  const res = await fetch(`${GA4_URL}/properties/${propId}:batchRunReports`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GA4 API ${res.status}: ${err}`);
  }
  return res.json();
}

// ── Row parser ─────────────────────────────────────────────────────────────────
function rows(report) {
  if (!report || !report.rows) return [];
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
    'Cache-Control': 'public, max-age=900' // cache 15 min
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // Verifica configuração
  const clientId     = process.env.GA4_CLIENT_ID;
  const clientSecret = process.env.GA4_CLIENT_SECRET;
  const refreshToken = process.env.GA4_REFRESH_TOKEN;
  const propertyId   = process.env.GA4_PROPERTY_ID;

  if (!clientId || !clientSecret || !refreshToken || !propertyId) {
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        status: 'GA4_NOT_CONFIGURED',
        message: 'Adicione GA4_CLIENT_ID, GA4_CLIENT_SECRET, GA4_REFRESH_TOKEN e GA4_PROPERTY_ID nas Environment Variables do Netlify.'
      })
    };
  }

  try {
    const token = await getToken(clientId, clientSecret, refreshToken);

    const { startDate = '30daysAgo', endDate = 'today' } = event.queryStringParameters || {};
    const dateRanges = [{ startDate, endDate }];

    // ── BATCH 1: KPIs + Timeline + Pages + Sources + Devices ──────────────────
    const b1 = await batchRun(token, propertyId, [
      // 0 – KPIs gerais
      { dateRanges, metrics: [
        { name: 'sessions' }, { name: 'totalUsers' }, { name: 'screenPageViews' },
        { name: 'averageSessionDuration' }, { name: 'bounceRate' }, { name: 'newUsers' }
      ]},
      // 1 – Timeline diária
      { dateRanges,
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'screenPageViews' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
        limit: 90
      },
      // 2 – Top páginas
      { dateRanges,
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'screenPageViews' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 8
      },
      // 3 – Fontes de tráfego
      { dateRanges,
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 8
      },
      // 4 – Dispositivos
      { dateRanges,
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'sessions' }]
      }
    ]);

    // ── BATCH 2: Demográficos + Geo + Novos vs Recorrentes ────────────────────
    const b2 = await batchRun(token, propertyId, [
      // 0 – Gênero
      { dateRanges, dimensions: [{ name: 'userGender' }], metrics: [{ name: 'totalUsers' }] },
      // 1 – Faixa etária
      { dateRanges, dimensions: [{ name: 'userAgeBracket' }], metrics: [{ name: 'totalUsers' }] },
      // 2 – Estados (região)
      { dateRanges,
        dimensions: [{ name: 'region' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 12
      },
      // 3 – Cidades
      { dateRanges,
        dimensions: [{ name: 'city' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10
      },
      // 4 – Novos vs Recorrentes
      { dateRanges, dimensions: [{ name: 'newVsReturning' }], metrics: [{ name: 'sessions' }] }
    ]);

    // ── BATCH 3: Browser + OS + Hora + Dia da semana ─────────────────────────
    const b3 = await batchRun(token, propertyId, [
      // 0 – Browser
      { dateRanges,
        dimensions: [{ name: 'browser' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 8
      },
      // 1 – Sistema operacional
      { dateRanges,
        dimensions: [{ name: 'operatingSystem' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 6
      },
      // 2 – Hora do dia (0–23)
      { dateRanges,
        dimensions: [{ name: 'hour' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ dimension: { dimensionName: 'hour' } }],
        limit: 24
      },
      // 3 – Dia da semana (0=Dom … 6=Sáb)
      { dateRanges,
        dimensions: [{ name: 'dayOfWeek' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ dimension: { dimensionName: 'dayOfWeek' } }]
      }
    ]);

    // ── Monta KPIs ─────────────────────────────────────────────────────────────
    const kpiRow = b1.reports?.[0]?.rows?.[0];
    const kpis = {
      sessions:    parseFloat(kpiRow?.metricValues?.[0]?.value || 0),
      users:       parseFloat(kpiRow?.metricValues?.[1]?.value || 0),
      pageViews:   parseFloat(kpiRow?.metricValues?.[2]?.value || 0),
      avgDuration: parseFloat(kpiRow?.metricValues?.[3]?.value || 0), // segundos
      bounceRate:  parseFloat(kpiRow?.metricValues?.[4]?.value || 0), // 0–1
      newUsers:    parseFloat(kpiRow?.metricValues?.[5]?.value || 0)
    };

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        status:   'ok',
        period:   { startDate, endDate },
        kpis,
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
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ status: 'error', message: err.message })
    };
  }
};
