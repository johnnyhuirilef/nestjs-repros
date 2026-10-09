import { Inject, Injectable } from '@nestjs/common';
import got from 'got';
import PCancelable from 'p-cancelable';

export const DATA_URL = 'DATA_URL';
export const SLOW_TASK_MILLISECONDS = 300;

@Injectable()
export class DataService {
  constructor(@Inject(DATA_URL) private readonly dataUrl: string) {}

  // got returns a promise that also has .json(), .text() and .buffer().
  fetchJson() {
    return got(this.dataUrl);
  }

  // p-cancelable returns a promise that also has .cancel().
  slowTask() {
    return new PCancelable<string>((resolve, _reject, onCancel) => {
      const timer = setTimeout(() => resolve('finished'), SLOW_TASK_MILLISECONDS);
      onCancel(() => clearTimeout(timer));
    });
  }
}
