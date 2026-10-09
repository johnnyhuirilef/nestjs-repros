import http from 'node:http';
import 'reflect-metadata';
import { HttpClient, HttpResponseError } from '@nestjs/http-client';

const ETAG = '"v1"';

// 304 is the normal answer to a request that repeats the ETag it has cached.
const server = http.createServer((req, res) => {
  if (req.headers['if-none-match'] === ETAG) {
    res.writeHead(304, { etag: ETAG });
    res.end();
    return;
  }
  res.writeHead(200, { etag: ETAG, 'content-type': 'application/json' });
  res.end(JSON.stringify({ name: 'cat' }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

const client = new HttpClient({ baseUrl });
const conditional = { headers: { 'if-none-match': ETAG } };

const first = await client.get('/item');
console.log('1. first GET               ->', first.status, JSON.stringify(first.data));

try {
  const second = await client.get('/item', conditional);
  console.log('2. GET with If-None-Match  ->', second.status, second.data);
} catch (error) {
  if (!(error instanceof HttpResponseError)) throw error;
  console.log('2. GET with If-None-Match  -> THROWS HttpResponseError:', error.message);
}

const third = await client.get('/item', { ...conditional, throwOnHttpError: false });
console.log('3. same, throwOnHttpError: false ->', third.status, third.data);

server.close();
