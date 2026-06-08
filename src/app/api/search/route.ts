import { source } from '@/lib/source';
import type { Tokenizer } from '@orama/orama';
import { createFromSource } from 'fumadocs-core/search/server';

const cjkPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const tokenPattern =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[a-z0-9]+/giu;

const searchTokenizer: Tokenizer = {
  language: 'cjk',
  normalizationCache: new Map(),
  tokenize(raw) {
    if (typeof raw !== 'string') return [raw];

    const tokens: string[] = [];
    const parts = raw.toLowerCase().normalize('NFKC').match(tokenPattern) ?? [];

    for (const part of parts) {
      if (!cjkPattern.test(part)) {
        tokens.push(part);
        continue;
      }

      const chars = Array.from(part);
      const maxGram = Math.min(chars.length, 4);

      for (let size = 1; size <= maxGram; size++) {
        for (let start = 0; start <= chars.length - size; start++) {
          tokens.push(chars.slice(start, start + size).join(''));
        }
      }

      if (chars.length > maxGram) tokens.push(part);
    }

    return Array.from(new Set(tokens));
  },
};

export const { GET } = createFromSource(source, {
  tokenizer: searchTokenizer,
});
