import { Inject, Injectable } from '@nestjs/common';
import {
  AuthenticationRegistry,
  PasswordHasher,
  PasswordResetHandler,
  SessionCookieProvider,
  type PasswordResetAccount,
  type PasswordResetLink,
} from '@nestjs/authentication';

export const EMAIL = 'ada@example.com';
export const USER_ID = 'user-1';

interface Account {
  id: string;
  email: string;
  passwordHash: string;
}

// One in-memory user and the mailbox that receives the reset links.
@Injectable()
export class Accounts extends PasswordResetHandler {
  private account: Account | undefined;
  private readonly mailbox: PasswordResetLink[] = [];

  constructor(
    @Inject(AuthenticationRegistry) registry: AuthenticationRegistry,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
  ) {
    super();
    registry.registerHandler('passwordReset', this);
  }

  async createUser(password: string): Promise<void> {
    this.account = { id: USER_ID, email: EMAIL, passwordHash: await this.hasher.hash(password) };
  }

  passwordMatches(password: string): Promise<boolean> {
    return this.hasher.verify(password, this.account?.passwordHash);
  }

  findUser(email: string): PasswordResetAccount | null {
    return this.account?.email === email ? this.account : null;
  }

  send(link: PasswordResetLink): void {
    this.mailbox.push(link);
  }

  updatePassword(userId: string, passwordHash: string): void {
    if (this.account?.id === userId) this.account.passwordHash = passwordHash;
  }

  takeResetToken(): string | undefined {
    const link = this.mailbox.pop();
    if (!link) return undefined;
    return new URL(link.url).searchParams.get('token') ?? undefined;
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
