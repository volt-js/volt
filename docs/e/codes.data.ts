// The list behind /e/, from the same extraction as the pages it links to.
import { errorCodes } from '../.vitepress/error-codes';

export interface CodeSummary {
  code: string;
  family: string;
  summary: string;
  inProduction: boolean;
}

declare const data: CodeSummary[];
export { data };

export default {
  watch: ['../../packages/*/src/**/*.ts'],
  load(): CodeSummary[] {
    return errorCodes().map((error) => ({
      code: error.code,
      family: error.family,
      // The first sentence, which is the one that names the failure.
      summary: error.message.split(/(?<=\.)\s/)[0]!.replace(/`/g, ''),
      inProduction: error.inProduction,
    }));
  },
};
