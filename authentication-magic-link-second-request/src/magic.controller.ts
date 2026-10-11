import { Body, Controller, HttpCode, Inject, Post, UnauthorizedException } from '@nestjs/common';
import { MagicLinkService, Public } from '@nestjs/authentication';
import { EMAIL } from './accounts.js';

@Public()
@Controller()
export class MagicController {
  constructor(@Inject(MagicLinkService) private readonly magicLinkService: MagicLinkService) {}

  // The "send link" button.
  @Post('request')
  @HttpCode(202)
  async request(): Promise<void> {
    await this.magicLinkService.create(EMAIL);
  }

  // The page behind the link in the email. The module turns a refusal into a 401.
  @Post('open')
  @HttpCode(200)
  async open(@Body('token') token: string): Promise<{ ok: true }> {
    const result = await this.magicLinkService.consume(token);
    if (!result) throw new UnauthorizedException('Invalid or expired link');
    return { ok: true };
  }
}
