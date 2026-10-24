import { handle } from './router.js';

export default {
  async fetch(request, env, ctx) {
    return handle(request, env, ctx);
  }
};
