export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const endpoint = req.query.endpoint;
  if (!endpoint) {
    res.status(400).json({ error: 'Missing endpoint' });
    return;
  }

  const apiKey = process.env.HCP_API_KEY;
  const url = `https://api.housecallpro.com/${endpoint}`;

  try {
    const hcpRes = await fetch(url, {
      method: req.method,
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    const json = await hcpRes.json();
    res.status(hcpRes.status).json(json);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
