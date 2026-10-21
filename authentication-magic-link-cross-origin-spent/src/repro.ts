import 'reflect-metadata';
import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Injectable,
  Module,
  Post,
  UnauthorizedException,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  AuthenticationModule,
  AuthenticationRegistry,
  MagicLinkHandler,
  MagicLinkService,
  Public,
  type MagicLink,
} from '@nestjs/authentication';

const APP_ORIGIN = 'http://app.test';
// An admin SPA on a sibling subdomain that is missing from `session.trustedOrigins`.
const UNTRUSTED_ORIGIN = 'http://admin.app.test';

const mailbox: MagicLink[] = [];

@Injectable()
class MailMagicLinks extends MagicLinkHandler {
  // tsx does not emit decorator metadata, so the tokens are explicit.
  constructor(@Inject(AuthenticationRegistry) registry: AuthenticationRegistry) {
    super();
    registry.registerHandler('magicLink', this);
  }
  send(link: MagicLink) {
    mailbox.push(link);
  }
  resolveUser(email: string) {
    return { id: 'u1', email };
  }
}

@Controller('auth/magic')
class MagicLinkController {
  constructor(@Inject(MagicLinkService) private readonly magicLinks: MagicLinkService) {}

  @Public()
  @Post()
  @HttpCode(202)
  async create(@Body('email') email: string) {
    await this.magicLinks.create(email);
  }

  @Public()
  @Post('consume')
  @HttpCode(200)
  async consume(@Body('token') token: string) {
    const signedIn = await this.magicLinks.consume(token);
    if (!signedIn) throw new UnauthorizedException();
    return { signedIn: true };
  }
}

@Module({
  imports: [
    AuthenticationModule.forRoot({
      session: { cookie: { secure: false } },
      magicLink: { url: `${APP_ORIGIN}/magic` },
    }),
  ],
  controllers: [MagicLinkController],
  providers: [MailMagicLinks],
})
class AppModule {}

function linkCookie(response: request.Response): string {
  const cookies = ([] as string[]).concat(response.headers['set-cookie'] ?? []);
  return (cookies.find((cookie) => cookie.startsWith('__Host-magic_link_tx=')) ?? '').split(';')[0];
}

async function requestLink(app: INestApplication) {
  const response = await request(app.getHttpServer()).post('/auth/magic').send({ email: 'ada@example.com' });
  const token = new URL(mailbox.at(-1)!.url).searchParams.get('token')!;
  return { token, cookie: linkCookie(response) };
}

async function openLink(app: INestApplication, link: { token: string; cookie: string }, origin: string) {
  const response = await request(app.getHttpServer())
    .post('/auth/magic/consume')
    .set('Host', 'app.test')
    .set('Origin', origin)
    .set('Cookie', link.cookie)
    .send({ token: link.token });
  const message = response.status === 200 ? 'signed in' : String(response.body.message);
  return { status: response.status, line: `${response.status} ${message}` };
}

const print = (label: string, value: string) => console.log(`  ${`${label}:`.padEnd(34)} ${value}`);

const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
const app = moduleRef.createNestApplication({ logger: false });
await app.init();

console.log('=== the link is opened from the app (control) ===');
const control = await openLink(app, await requestLink(app), APP_ORIGIN);
print(`open from ${APP_ORIGIN}`, control.line);
print('expected', '200 signed in');
console.log('');

console.log('=== the link is opened from an untrusted origin first ===');
const link = await requestLink(app);
const refused = await openLink(app, link, UNTRUSTED_ORIGIN);
print(`open from ${UNTRUSTED_ORIGIN}`, refused.line);
const retried = await openLink(app, link, APP_ORIGIN);
print(`then open from ${APP_ORIGIN}`, retried.line);
print('expected', '403 first, then 200 signed in');
console.log('');

await app.close();

if (control.status !== 200 || refused.status !== 403) {
  console.log('RESULT: INCONCLUSIVE: the control or the refusal did not answer as expected.');
  process.exitCode = 2;
} else if (retried.status !== 200) {
  console.log('RESULT: BUG: the refused request spent the link.');
  process.exitCode = 1;
} else {
  console.log('RESULT: FIXED');
}
