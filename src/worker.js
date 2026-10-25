import { handle } from './router.js';
import { rollupUsage } from './rollup.js';

export default {
  async fetch(request, env, ctx) {
    return handle(request, env, ctx);
  },

  // Nightly (wrangler.jsonc triggers.crons): roll closed days of app_usage
  // into usage_daily. See src/rollup.js. Errors are logged, never swallowed
  // silently: a thrown error marks the cron run as failed in the dashboard.
  async scheduled(controller, env, ctx) {
    const result = await rollupUsage(env, { actor: null });
    console.log('usage rollup', controller.cron, JSON.stringify(result));
  }
};
