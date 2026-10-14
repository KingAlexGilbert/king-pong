export {default, MatchmakingQueue} from '../src/worker.js';
import {PongRoom} from '../src/worker.js';
export class TestPongRoom extends PongRoom {
  async fetch(request) {
    if (new URL(request.url).pathname === '/test-party-age') {
      const room = await this.ctx.storage.get('party-room'); room.waitAt = Date.now() - 180001;
      await this.ctx.storage.put('party-room', room); return new Response('ok');
    }
    return super.fetch(request);
  }
}
export class TestTurn {
  async fetch() { return Response.json([{urls: 'turn:fixture.invalid:3478', username: 'temporary-test', credential: 'fixture-only'}]); }
}
