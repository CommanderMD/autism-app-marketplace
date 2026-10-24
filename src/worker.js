import { AutismAppMarketplace } from './marketplace.js';

export default {
  async fetch(request, env, ctx) {
    return await AutismAppMarketplace.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    // Handle scheduled tasks (cleanup, analytics, etc.)
    return AutismAppMarketplace.scheduled(controller, env, ctx);
  }
};