// Chamado pelo webhook do Netlify Forms quando chega novo cadastro
const { getStore } = require('@netlify/blobs');
const webpush = require('web-push');

webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

exports.handler = async (event) => {
  try {
    const payload = JSON.parse(event.body || '{}');
    const data = payload.data || {};
    const nome = data.nome || 'Novo candidato';
    const cidade = data.cidade || '';

    const store = getStore('push-subscriptions');
    const subscription = await store.get('admin', { type: 'json' });

    if (!subscription) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, msg: 'Sem subscriber' }) };
    }

    const notification = JSON.stringify({
      title: '🍿 Novo Lead PopGo!',
      body: `${nome}${cidade ? ' · ' + cidade : ''} acabou de se cadastrar`,
      icon: '/assets/icon-192.png',
      badge: '/assets/icon-192.png',
      url: '/admin.html'
    });

    await webpush.sendNotification(subscription, notification);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error('notify error:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
