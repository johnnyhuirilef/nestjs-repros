import { Controller, Get, Inject } from '@nestjs/common';
import { DataService } from './data.service.js';

const CANCEL_DELAY_MILLISECONDS = 20;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

@Controller()
export class DataController {
  constructor(@Inject(DataService) private readonly data: DataService) {}

  @Get('data')
  async readData(): Promise<unknown> {
    return await this.data.fetchJson().json();
  }

  @Get('cancel')
  async cancelTask(): Promise<{ cancelExists: boolean; ending: string }> {
    const task = this.data.slowTask();
    const cancelExists = typeof task.cancel === 'function';
    // The rejection handler is attached before the task can settle.
    const ending = task.then(
      (value) => value,
      (error: unknown) => `rejected: ${error instanceof Error ? error.name : String(error)}`,
    );
    await wait(CANCEL_DELAY_MILLISECONDS);
    if (cancelExists) task.cancel();
    return { cancelExists, ending: await ending };
  }
}
