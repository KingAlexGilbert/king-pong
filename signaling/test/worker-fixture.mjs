import worker, { PongRoom } from '../src/worker.js';
import { MeteredTurn as ProductionMeteredTurn } from '../src/metered-turn.js';

export { PongRoom };
export default worker;

// Only the test entrypoint exposes these controls; Wrangler deploys src/worker.js.
export class MeteredTurn extends ProductionMeteredTurn {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/test-propagated') {
      const state = await this.ctx.storage.get('turn');
      state.pending.readyAt = Date.now() - 1;
      await this.ctx.storage.put('turn', state);
      return super.fetch(new Request('https://turn/ready'));
    }
    if (path === '/test-reset') {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return new Response(null, { status: 204 });
    }
    return super.fetch(request);
  }
}
