import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { PasswordResetService, Public } from '@nestjs/authentication';
import { EMAIL } from './accounts.js';

interface ResetBody {
  token: string;
  password: string;
  signIn: boolean;
}

@Public()
@Controller()
export class ResetController {
  constructor(@Inject(PasswordResetService) private readonly passwordResetService: PasswordResetService) {}

  @Post('forgot')
  @HttpCode(202)
  forgot(): void {
    this.passwordResetService.request(EMAIL);
  }

  @Post('reset')
  @HttpCode(200)
  async reset(@Body() body: ResetBody): Promise<{ ok: boolean; signedIn: boolean }> {
    const result = await this.passwordResetService.reset(body.token, body.password, { signIn: body.signIn });
    return { ok: result !== null, signedIn: Boolean(result?.signedIn) };
  }
}
