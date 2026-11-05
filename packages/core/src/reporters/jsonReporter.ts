import { ReviewResult } from '@cr/shared';

export class JsonReporter {
  format(result: ReviewResult): string {
    return JSON.stringify(result, null, 2);
  }
}
