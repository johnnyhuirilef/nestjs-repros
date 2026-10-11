import { Inject, Injectable } from '@nestjs/common';
import {
  AuthenticationRegistry,
  MagicLinkHandler,
  SessionCookieProvider,
  type MagicLink,
} from '@nestjs/authentication';

export const EMAIL = 'ada@example.com';

// One in-memory user and the mailbox that receives the magic links.
@Injectable()
export class Accounts extends MagicLinkHandler {
  private readonly mailbox: MagicLink[] = [];

  constructor(@Inject(AuthenticationRegistry) registry: AuthenticationRegistry) {
    super();
    registry.registerHandler('magicLink', this);
  }

  send(link: MagicLink): void {
    this.mailbox.push(link);
  }

  resolveUser(email: string): { id: string; email: string } {
    return { id: 'user-1', email };
  }

  takeToken(): string {
    const link = this.mailbox.pop();
    if (!link) throw new Error('No magic link arrived in the mailbox');
    const token = new URL(link.url).searchParams.get('token');
    if (!token) throw new Error('The magic link has no token');
    return token;
  }
}

// The session cookie provider the sign-in step needs.
@Injectable()
export class SessionAuth extends SessionCookieProvider<{ id: string }> {
  constructor(@Inject(AuthenticationRegistry) registry: AuthenticationRegistry) {
    super();
    registry.registerProvider(this);
  }

  validate(session: { userId: string }): { id: string } {
    return { id: session.userId };
  }
}
