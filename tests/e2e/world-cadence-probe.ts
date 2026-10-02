import { Protocol } from '@colyseus/sdk';
import { decode } from '@colyseus/schema';
import { unpack } from 'msgpackr';
import type { Page } from '@playwright/test';
import { worldSnapshotSchema, type WorldSnapshot } from '@pokewaterblue/protocol';

/** Passive decoding follows the installed SDK's ROOM_DATA decoder. No frames change. */
export function observeWorldCadence(page: Page) {
  const motions: NonNullable<WorldSnapshot['self']['motion']>[] = [], errors: string[] = [];
  const busyMessages: string[] = [];
  const inputs: { receivedAt: number; estimatedServerTime: number; previousMotionEnd: number | null }[] = [];
  let latest: { snapshot: WorldSnapshot; receivedAt: number } | undefined;
  page.on('websocket', socket => {
    function message(payload: string | Buffer) {
      if (typeof payload === 'string' || payload[0] !== Protocol.ROOM_DATA) return;
      const iterator = { offset: 1 };
      if (!decode.stringCheck(payload, iterator)) return;
      const type = decode.string(payload, iterator);
      return { type, value: unpack(payload, { start: iterator.offset }) as unknown };
    }
    socket.on('framereceived', ({ payload }) => {
      const decoded = message(payload); if (!decoded) return;
      if (decoded.type === 'error' && decoded.value && typeof decoded.value === 'object' && 'code' in decoded.value) {
        errors.push(String(decoded.value.code));
        if (decoded.value.code === 'BUSY' && 'message' in decoded.value) busyMessages.push(String(decoded.value.message));
      }
      if (decoded.type !== 'world') return;
      const snapshot = worldSnapshotSchema.parse(decoded.value); latest = { snapshot, receivedAt: performance.now() };
      const motion = snapshot.self.motion;
      if (motion && !motions.some(previous => previous.startedAt === motion.startedAt)) motions.push(motion);
    });
    socket.on('framesent', ({ payload }) => {
      if (message(payload)?.type !== 'world-input' || !latest) return;
      const receivedAt = performance.now(), motion = latest.snapshot.self.motion;
      inputs.push({ receivedAt, estimatedServerTime: latest.snapshot.serverTime + receivedAt - latest.receivedAt,
        previousMotionEnd: motion ? motion.startedAt + motion.durationMs : null });
    });
  });
  return { motions, errors, busyMessages, inputs };
}
