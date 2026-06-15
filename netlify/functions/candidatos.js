exports.handler = async () => {
  const token = process.env.NETLIFY_TOKEN;
  const siteId = process.env.SITE_ID || '4f97fb33-1b4f-4ad0-ac61-3f30454cd79a';

  try {
    // Get forms list
    const formsRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/forms`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const forms = await formsRes.json();

    let submissions = [];
    if (forms.length > 0) {
      const formId = forms[0].id;
      const subRes = await fetch(`https://api.netlify.com/api/v1/forms/${formId}/submissions?per_page=100`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      submissions = await subRes.json();
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ forms, submissions })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
