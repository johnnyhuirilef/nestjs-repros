// A TCP server on 127.0.0.1:465 that only records how the client starts: a TLS ClientHello
// (first byte 0x16, implicit TLS) or nothing, because the client waits for an SMTP greeting.
// Port 465 matters: SmtpTransport turns `secure` on by default for that port.
import { createServer } from 'node:net';
import { SmtpTransport } from '@nestjs/mail';

const PORT = 465;
let firstByte;
const server = createServer((socket) => {
  socket.once('data', (data) => (firstByte = data[0]));
  socket.on('error', () => {});
});
// macOS lets a normal user listen on a port under 1024 only on the wildcard address; on Linux, run it as root.
// The server only reads the first bytes, and the script closes it at the end.
await new Promise((resolve, reject) => server.once('error', reject).listen(PORT, '0.0.0.0', resolve));

async function check(title, options) {
  firstByte = undefined;
  const transport = new SmtpTransport({ ...options, timeouts: { connect: '1s', greeting: '1s' } });
  const error = await transport.verify().then(() => undefined, (err) => err);
  const start = firstByte === 0x16 ? 'TLS ClientHello (implicit TLS)' : firstByte === undefined ? 'nothing: waits for the SMTP greeting' : `byte 0x${firstByte.toString(16)}`;
  console.log(`=== ${title} ===`);
  console.log(`  the client sends first: ${start}`);
  console.log(`  verify(): ${error ? `${error.name}` : 'ok'}`);
  console.log();
  return firstByte === 0x16;
}

const results = {
  hostPort: await check("{ host: '127.0.0.1', port: 465 } (control)", { host: '127.0.0.1', port: PORT }),
  smtps: await check("url 'smtps://127.0.0.1:465' (control)", { url: `smtps://127.0.0.1:${PORT}` }),
  smtpUrl: await check("url 'smtp://127.0.0.1:465'", { url: `smtp://127.0.0.1:${PORT}` }),
  urlAndPort: await check("url 'smtp://127.0.0.1' with port: 465", { url: 'smtp://127.0.0.1', port: PORT }),
};
server.close();

const missing = Object.entries(results).filter(([, tls]) => !tls).map(([name]) => name);
if (results.hostPort && results.smtps && missing.length > 0) {
  console.log(`RESULT: BUG: with a url, port 465 does not turn on implicit TLS (${missing.join(', ')}).`);
  process.exitCode = 1;
} else {
  console.log('RESULT: FIXED: port 465 turns on implicit TLS with a url too.');
}
