import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledTask } from './scheduled-tasks-storage.js';

beforeEach(() => vi.resetModules());
const load = async () => (await import('./scheduled-tasks-storage.js')).scheduledTasksStorage;

function task(over: Partial<ScheduledTask> = {}): ScheduledTask {
  return { id: 't1', name: 'Daily', prompt: 'check', nextRunAt: 1000, repeat: 'daily', enabled: true, ...over };
}

describe('scheduledTasksStorage', () => {
  it('upsert adds then replaces by id', async () => {
    const s = await load();
    await s.upsert(task({ name: 'A' }));
    await s.upsert(task({ name: 'B' }));
    const state = await s.get();
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].name).toBe('B');
  });

  it('setEnabled toggles only the targeted task', async () => {
    const s = await load();
    await s.upsert(task({ id: 't1' }));
    await s.upsert(task({ id: 't2' }));
    await s.setEnabled('t1', false);
    const state = await s.get();
    expect(state.tasks.find(t => t.id === 't1')?.enabled).toBe(false);
    expect(state.tasks.find(t => t.id === 't2')?.enabled).toBe(true);
  });

  it('recordRun logs success and failure with optional error', async () => {
    const s = await load();
    await s.upsert(task({ id: 't1' }));
    await s.recordRun('t1', true);
    let t = (await s.get()).tasks[0];
    expect(t.lastSuccess).toBe(true);
    expect(typeof t.lastRunAt).toBe('number');

    await s.recordRun('t1', false, 'network down');
    t = (await s.get()).tasks[0];
    expect(t.lastSuccess).toBe(false);
    expect(t.lastError).toBe('network down');
  });

  it('remove deletes by id', async () => {
    const s = await load();
    await s.upsert(task({ id: 't1' }));
    await s.remove('t1');
    expect((await s.get()).tasks).toHaveLength(0);
  });
});
