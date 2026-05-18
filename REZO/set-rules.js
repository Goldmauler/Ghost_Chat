const https = require('https');

const rules = JSON.stringify({ rules: { '.read': true, '.write': true } });

const options = {
  hostname: 'rezo-7f0d0-default-rtdb.firebaseio.com',
  path: '/.settings/rules.json',
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(rules),
  },
};

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => {
    console.log('HTTP Status:', res.statusCode);
    console.log('Response body:', body);
  });
});

req.on('error', (e) => {
  console.error('Request error:', e.message);
});

req.write(rules);
req.end();
