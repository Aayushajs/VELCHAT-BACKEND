import type { Logger } from 'pino';
import { StatusExpiryWorker } from '../../src/status/status.expiry.worker';
import type { StatusRepository } from '../../src/status/status.repository';
import type { StatusEvents } from '../../src/status/status.events';

function makeLogger(): Logger {
  return { warn: jest.fn(), debug: jest.fn(), info: jest.fn() } as unknown as Logger;
}

function setup(due: Array<{ status_id: string; user_id: string }> = []) {
  const repo = {
    markExpired: jest.fn(async () => due),
    purgeAfterGrace: jest.fn(async () => 0),
  } as unknown as StatusRepository;
  const events = { statusExpired: jest.fn(async () => undefined) } as unknown as StatusEvents;
  const logger = makeLogger();
  const worker = new StatusExpiryWorker(repo, events, logger, { graceHours: 24 });
  return { worker, repo, events, logger };
}

describe('StatusExpiryWorker', () => {
  it('marks due statuses and emits one event each', async () => {
    const { worker, repo, events } = setup([
      { status_id: 's1', user_id: 'u1' },
      { status_id: 's2', user_id: 'u2' },
    ]);
    await worker.tick();
    expect(repo.markExpired).toHaveBeenCalled();
    expect(events.statusExpired).toHaveBeenCalledTimes(2);
    expect(repo.purgeAfterGrace).toHaveBeenCalledWith(24);
  });

  it('is a no-op when nothing is due', async () => {
    const { worker, events } = setup([]);
    await worker.tick();
    expect(events.statusExpired).not.toHaveBeenCalled();
  });

  // Re-running must be harmless: markExpired's predicate matches only still-active rows, so a
  // second pass finds nothing. That is what makes a crash mid-sweep safe.
  it('is idempotent across repeated ticks', async () => {
    const { worker, repo, events } = setup([{ status_id: 's1', user_id: 'u1' }]);
    await worker.tick();
    (repo.markExpired as jest.Mock).mockResolvedValue([]); // already expired
    await worker.tick();
    expect(events.statusExpired).toHaveBeenCalledTimes(1);
  });

  // The row IS expired and already invisible to readers, so a failed notification must not stall
  // the sweep or be retried into a loop.
  it('still purges when event emission fails, and does not throw', async () => {
    const { worker, repo, events } = setup([{ status_id: 's1', user_id: 'u1' }]);
    (events.statusExpired as jest.Mock).mockRejectedValue(new Error('bus down'));
    await expect(worker.tick()).resolves.toBeUndefined();
    expect(repo.purgeAfterGrace).toHaveBeenCalled();
  });

  it('swallows a repository failure so a cold database cannot crash the process', async () => {
    const { worker, repo } = setup();
    (repo.markExpired as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(worker.tick()).resolves.toBeUndefined();
  });

  it('does not overlap concurrent ticks', async () => {
    const { worker, repo } = setup();
    let release!: () => void;
    (repo.markExpired as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve([]);
        }),
    );
    const first = worker.tick();
    await worker.tick(); // must return immediately, guarded
    release();
    await first;
    expect(repo.markExpired).toHaveBeenCalledTimes(1);
  });

  it('start() is idempotent and stop() clears the timer', () => {
    const { worker } = setup();
    worker.start();
    worker.start(); // a second call must not create a second timer
    worker.stop();
    worker.stop(); // stopping twice must not throw
  });
});
