import { describe, it, expect, beforeEach } from 'vitest';
import { setLocale, getLocale, t } from '../src/i18n/index.js';
import { en } from '../src/i18n/en.js';
import { ptBr } from '../src/i18n/pt-br.js';

describe('i18n', () => {
  beforeEach(() => {
    setLocale('en');
  });

  it('defaults to English', () => {
    expect(getLocale()).toBe('en');
    expect(t().success_title).toBe('Lox is ready.');
  });

  it('switches to pt-BR', () => {
    setLocale('pt-br');
    expect(getLocale()).toBe('pt-br');
    expect(t().success_title).toBe('Lox esta pronto.');
  });

  it('pt-BR has all keys that English has', () => {
    const enKeys = Object.keys(en).sort();
    const ptKeys = Object.keys(ptBr).sort();
    expect(ptKeys).toEqual(enKeys);
  });

  it('no empty strings in either locale', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value, `en.${key} is empty`).not.toBe('');
    }
    for (const [key, value] of Object.entries(ptBr)) {
      expect(value, `pt-br.${key} is empty`).not.toBe('');
    }
  });
});
