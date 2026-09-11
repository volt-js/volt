// One page per error code, generated from the source at build time — see
// ../.vitepress/error-codes.ts for why they are not written by hand.
import { errorCodes, renderErrorPage } from '../.vitepress/error-codes';

export default {
  paths() {
    return errorCodes().map((error) => ({
      params: { code: error.code },
      content: renderErrorPage(error),
    }));
  },
};
