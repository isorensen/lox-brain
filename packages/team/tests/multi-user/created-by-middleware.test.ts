import { describe, it, expect, vi } from 'vitest';
import { wrapToolWithCreatedBy } from '../../src/multi-user/created-by-middleware.js';
import { PeerResolver } from '../../src/multi-user/peer-resolver.js';
import type { VpnPeer } from '@lox-brain/shared';

describe('wrapToolWithCreatedBy', () => {
  const peers: VpnPeer[] = [
    { name: 'eduardo', ip: '10.10.0.2', public_key: 'key1', added_at: '2026-04-03' },
  ];
  const resolver = new PeerResolver(peers);

  it('should inject _created_by into write_note args', async () => {
    const innerHandler = vi.fn().mockResolvedValue({ written: 'test.md' });
    const tool = { name: 'write_note', description: 'Write', inputSchema: {}, handler: innerHandler };
    const wrapped = wrapToolWithCreatedBy(tool, resolver, () => '10.10.0.2');
    await wrapped.handler({ file_path: 'test.md', content: 'hello' });
    expect(innerHandler).toHaveBeenCalledWith({
      file_path: 'test.md', content: 'hello', _created_by: 'eduardo',
    });
  });

  it('should not inject _created_by for read_note', async () => {
    const innerHandler = vi.fn().mockResolvedValue({ content: 'data' });
    const tool = { name: 'read_note', description: 'Read', inputSchema: {}, handler: innerHandler };
    const wrapped = wrapToolWithCreatedBy(tool, resolver, () => '10.10.0.2');
    await wrapped.handler({ file_path: 'test.md' });
    expect(innerHandler).toHaveBeenCalledWith({ file_path: 'test.md' });
  });

  it('should not inject when peer is unknown', async () => {
    const innerHandler = vi.fn().mockResolvedValue({ written: 'test.md' });
    const tool = { name: 'write_note', description: 'Write', inputSchema: {}, handler: innerHandler };
    const wrapped = wrapToolWithCreatedBy(tool, resolver, () => '10.10.0.99');
    await wrapped.handler({ file_path: 'test.md', content: 'hello' });
    expect(innerHandler).toHaveBeenCalledWith({ file_path: 'test.md', content: 'hello' });
  });

  it('should not inject when IP getter returns null', async () => {
    const innerHandler = vi.fn().mockResolvedValue({ written: 'test.md' });
    const tool = { name: 'write_note', description: 'Write', inputSchema: {}, handler: innerHandler };
    const wrapped = wrapToolWithCreatedBy(tool, resolver, () => null);
    await wrapped.handler({ file_path: 'test.md', content: 'hello' });
    expect(innerHandler).toHaveBeenCalledWith({ file_path: 'test.md', content: 'hello' });
  });

  it('should overwrite a pre-existing _created_by in args', async () => {
    const innerHandler = vi.fn().mockResolvedValue({});
    const tool = { name: 'write_note', description: 'W', inputSchema: {}, handler: innerHandler };
    const wrapped = wrapToolWithCreatedBy(tool, resolver, () => '10.10.0.2');
    await wrapped.handler({ file_path: 'f.md', _created_by: 'attacker' });
    expect(innerHandler).toHaveBeenCalledWith({
      file_path: 'f.md', _created_by: 'eduardo',
    });
  });

  it('should preserve all other tool properties', () => {
    const tool = { name: 'write_note', description: 'My desc', inputSchema: { type: 'object' }, handler: vi.fn() };
    const wrapped = wrapToolWithCreatedBy(tool, resolver, () => '10.10.0.2');
    expect(wrapped.name).toBe('write_note');
    expect(wrapped.description).toBe('My desc');
    expect(wrapped.inputSchema).toEqual({ type: 'object' });
  });
});
