import { describe, it, expect, vi } from 'vitest';
import { wrapToolWithCreatedBy } from '../../src/multi-user/created-by-middleware.js';
import { PeerResolver } from '../../src/multi-user/peer-resolver.js';
import type { VpnPeer } from '@lox-brain/shared';

describe('wrapToolWithCreatedBy', () => {
  const peers: VpnPeer[] = [
    { name: 'eduardo', ip: '10.20.0.2', public_key: 'key1', added_at: '2026-04-03' },
  ];
  const resolver = new PeerResolver(peers);

  it('should inject _created_by into write_note args', async () => {
    const innerHandler = vi.fn().mockResolvedValue({ written: 'test.md' });
    const tool = { name: 'write_note', description: 'Write', inputSchema: {}, handler: innerHandler };
    const wrapped = wrapToolWithCreatedBy(tool, resolver, () => '10.20.0.2');
    await wrapped.handler({ file_path: 'test.md', content: 'hello' });
    expect(innerHandler).toHaveBeenCalledWith({
      file_path: 'test.md', content: 'hello', _created_by: 'eduardo',
    });
  });

  it('should inject _created_by into add_task args', async () => {
    const innerHandler = vi.fn().mockResolvedValue({ id: 'task-1' });
    const tool = { name: 'add_task', description: 'Add task', inputSchema: {}, handler: innerHandler };
    const wrapped = wrapToolWithCreatedBy(tool, resolver, () => '10.20.0.2');
    await wrapped.handler({ title: 'Ship Lox' });
    expect(innerHandler).toHaveBeenCalledWith({ title: 'Ship Lox', _created_by: 'eduardo' });
  });

  it('should inject _created_by into daily_log args', async () => {
    const innerHandler = vi.fn().mockResolvedValue({ written: 'daily-logs/2026-07-09.md' });
    const tool = { name: 'daily_log', description: 'Daily log', inputSchema: {}, handler: innerHandler };
    const wrapped = wrapToolWithCreatedBy(tool, resolver, () => '10.20.0.2');
    await wrapped.handler({ entry: 'shipped the fix' });
    expect(innerHandler).toHaveBeenCalledWith({ entry: 'shipped the fix', _created_by: 'eduardo' });
  });

  it('should not inject _created_by for update_task (must not overwrite original author)', async () => {
    const innerHandler = vi.fn().mockResolvedValue({ id: 'task-1' });
    const tool = { name: 'update_task', description: 'Update task', inputSchema: {}, handler: innerHandler };
    const wrapped = wrapToolWithCreatedBy(tool, resolver, () => '10.20.0.2');
    await wrapped.handler({ id: 'task-1', status: 'done' });
    expect(innerHandler).toHaveBeenCalledWith({ id: 'task-1', status: 'done' });
  });

  it('should not inject _created_by for read_note', async () => {
    const innerHandler = vi.fn().mockResolvedValue({ content: 'data' });
    const tool = { name: 'read_note', description: 'Read', inputSchema: {}, handler: innerHandler };
    const wrapped = wrapToolWithCreatedBy(tool, resolver, () => '10.20.0.2');
    await wrapped.handler({ file_path: 'test.md' });
    expect(innerHandler).toHaveBeenCalledWith({ file_path: 'test.md' });
  });

  it('should strip _created_by when peer is unknown (anti-spoofing)', async () => {
    const innerHandler = vi.fn().mockResolvedValue({ written: 'test.md' });
    const tool = { name: 'write_note', description: 'Write', inputSchema: {}, handler: innerHandler };
    const wrapped = wrapToolWithCreatedBy(tool, resolver, () => '10.20.0.99');
    await wrapped.handler({ file_path: 'test.md', content: 'hello', _created_by: 'attacker' });
    expect(innerHandler).toHaveBeenCalledWith({ file_path: 'test.md', content: 'hello' });
  });

  it('should strip _created_by when IP getter returns null (anti-spoofing)', async () => {
    const innerHandler = vi.fn().mockResolvedValue({ written: 'test.md' });
    const tool = { name: 'write_note', description: 'Write', inputSchema: {}, handler: innerHandler };
    const wrapped = wrapToolWithCreatedBy(tool, resolver, () => null);
    await wrapped.handler({ file_path: 'test.md', content: 'hello', _created_by: 'attacker' });
    expect(innerHandler).toHaveBeenCalledWith({ file_path: 'test.md', content: 'hello' });
  });

  it('should overwrite a pre-existing _created_by in args', async () => {
    const innerHandler = vi.fn().mockResolvedValue({});
    const tool = { name: 'write_note', description: 'W', inputSchema: {}, handler: innerHandler };
    const wrapped = wrapToolWithCreatedBy(tool, resolver, () => '10.20.0.2');
    await wrapped.handler({ file_path: 'f.md', _created_by: 'attacker' });
    expect(innerHandler).toHaveBeenCalledWith({
      file_path: 'f.md', _created_by: 'eduardo',
    });
  });

  it('should preserve all other tool properties', () => {
    const tool = { name: 'write_note', description: 'My desc', inputSchema: { type: 'object' }, handler: vi.fn() };
    const wrapped = wrapToolWithCreatedBy(tool, resolver, () => '10.20.0.2');
    expect(wrapped.name).toBe('write_note');
    expect(wrapped.description).toBe('My desc');
    expect(wrapped.inputSchema).toEqual({ type: 'object' });
  });

  // --- Trusted-proxy actor forwarding (chat backend path, #191) ---

  it('should use the trusted actor when present (chat backend path)', async () => {
    const innerHandler = vi.fn().mockResolvedValue({ id: 'task-1' });
    const tool = { name: 'add_task', description: 'Add task', inputSchema: {}, handler: innerHandler };
    // Caller is the backend (not a peer): IP does not resolve, but a trusted actor is forwarded.
    const wrapped = wrapToolWithCreatedBy(tool, resolver, () => null, () => 'Bob Silva');
    await wrapped.handler({ title: 'From chat' });
    expect(innerHandler).toHaveBeenCalledWith({ title: 'From chat', _created_by: 'Bob Silva' });
  });

  it('should prefer the trusted actor over a resolvable peer IP', async () => {
    const innerHandler = vi.fn().mockResolvedValue({ id: 'task-1' });
    const tool = { name: 'add_task', description: 'Add task', inputSchema: {}, handler: innerHandler };
    // Both signals present — actor (b > a) must win.
    const wrapped = wrapToolWithCreatedBy(tool, resolver, () => '10.20.0.2', () => 'Bob Silva');
    await wrapped.handler({ title: 'From chat' });
    expect(innerHandler).toHaveBeenCalledWith({ title: 'From chat', _created_by: 'Bob Silva' });
  });

  it('should overwrite a client-supplied _created_by with the trusted actor', async () => {
    const innerHandler = vi.fn().mockResolvedValue({ id: 'task-1' });
    const tool = { name: 'add_task', description: 'Add task', inputSchema: {}, handler: innerHandler };
    const wrapped = wrapToolWithCreatedBy(tool, resolver, () => null, () => 'Bob Silva');
    await wrapped.handler({ title: 'From chat', _created_by: 'attacker' });
    expect(innerHandler).toHaveBeenCalledWith({ title: 'From chat', _created_by: 'Bob Silva' });
  });

  it('should fall back to peer resolution when no trusted actor is present', async () => {
    const innerHandler = vi.fn().mockResolvedValue({ id: 'task-1' });
    const tool = { name: 'add_task', description: 'Add task', inputSchema: {}, handler: innerHandler };
    const wrapped = wrapToolWithCreatedBy(tool, resolver, () => '10.20.0.2', () => null);
    await wrapped.handler({ title: 'From peer' });
    expect(innerHandler).toHaveBeenCalledWith({ title: 'From peer', _created_by: 'eduardo' });
  });

  it('should strip _created_by when neither trusted actor nor peer resolves', async () => {
    const innerHandler = vi.fn().mockResolvedValue({ id: 'task-1' });
    const tool = { name: 'add_task', description: 'Add task', inputSchema: {}, handler: innerHandler };
    const wrapped = wrapToolWithCreatedBy(tool, resolver, () => null, () => null);
    await wrapped.handler({ title: 'orphan', _created_by: 'attacker' });
    expect(innerHandler).toHaveBeenCalledWith({ title: 'orphan' });
  });
});
