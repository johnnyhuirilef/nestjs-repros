import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AuthenticationEvents, AuthenticationModule } from '@nestjs/authentication';
import { Accounts, SessionAuth } from './accounts.js';
import { MagicController } from './magic.controller.js';

@Module({
  imports: [AuthenticationModule.forRoot({ magicLink: { url: 'http://127.0.0.1/magic' } })],
  controllers: [MagicController],
  providers: [Accounts, SessionAuth],
})
class AppModule {}

interface Answer {
  status: number;
  body: string;
}

// A browser that keeps cookies by name. It sends them back as they are.
class Browser {
  private readonly cookies = new Map<string, string>();

  constructor(
    private readonly baseUrl: string,
    saved?: Map<string, string>,
  ) {
    for (const [name, value] of saved ?? []) this.cookies.set(name, value);
  }

  snapshot(): Map<string, string> {
    return new Map(this.cookies);
  }

  get txCookie(): string {
    return this.cookies.get('__Host-magic_link_tx') ?? '(none)';
  }

  async post(path: string, payload: object): Promise<Answer> {
    const cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (cookie) headers['cookie'] = cookie;
    const response = await fetch(this.baseUrl + path, { method: 'POST', headers, body: JSON.stringify(payload) });
    for (const line of response.headers.getSetCookie()) {
      const [pair = '', ...attributes] = line.split('; ');
      const [name = '', value = ''] = pair.split(/=(.*)/s);
      if (value === '' || attributes.includes('Max-Age=0')) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return { status: response.status, body: await response.text() };
  }
}

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, new ExpressAdapter(), { logger: false, abortOnError: false });
  await app.listen(0, '127.0.0.1');
  const baseUrl = await app.getUrl();
  const accounts = app.get(Accounts);

  let events: string[] = [];
  app.get(AuthenticationEvents).events$.subscribe((event) => {
    events.push(event.type === 'magic-link-refused' ? `${event.type} (${event.reason})` : event.type);
  });

  const request = async (browser: Browser): Promise<string> => {
    await browser.post('/request', {});
    return accounts.takeToken();
  };
  const open = async (label: string, browser: Browser, token: string): Promise<Answer> => {
    events = [];
    const answer = await browser.post('/open', { token });
    console.log(`${label.padEnd(26)} ${answer.status} ${answer.body}`);
    console.log(`${''.padEnd(26)} event: ${events.join(', ') || '(none)'}`);
    return answer;
  };
  const cookieHint = (browser: Browser) => browser.txCookie.split('.')[0];

  console.log('--- control: one request, then open it ---');
  const controlBrowser = new Browser(baseUrl);
  const controlLink = await request(controlBrowser);
  const control = await open('open the link', controlBrowser, controlLink);

  console.log('\n--- case: two requests in the same browser ---');
  const browser = new Browser(baseUrl);
  const linkA = await request(browser);
  console.log(`request A: cookie ${cookieHint(browser)}`);
  const cookiesAfterA = browser.snapshot();
  const linkB = await request(browser);
  console.log(`request B: cookie ${cookieHint(browser)}`);
  const a = await open('open A (older link)', browser, linkA);
  const b = await open('open B (newer link)', browser, linkB);

  console.log('\n--- step 4: is link A still valid on the server? ---');
  console.log('A is opened again with the cookie that the browser held after request A.');
  await open('open A, old cookie back', new Browser(baseUrl, cookiesAfterA), linkA);

  await app.close();

  const reproduced = control.status === 200 && a.status === 401 && a.body.includes('not_this_browser') && b.status === 200;
  const fine = control.status === 200 && a.status === 200 && b.status === 200;
  if (reproduced) {
    console.log('\nRESULT: REPRODUCED: link A was refused with not_this_browser in the browser that requested it');
  } else if (fine) {
    console.log('\nRESULT: OK: link A opened in the browser that requested it');
  } else {
    console.log('\nRESULT: UNEXPECTED: see the statuses above');
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
