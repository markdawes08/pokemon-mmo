import { describe, expect, it } from 'vitest';
import type { DialogueFont } from '@pokewaterblue/content-schema';
import { layoutDialogue } from './dialogue-font';

const font: DialogueFont = {
  schemaVersion: 1, id: 'firered-latin-normal', image: '/content/fonts/dialogue.png',
  atlasWidth: 32, atlasHeight: 16, lineHeight: 15, letterSpacing: 0,
  glyphs: Object.fromEntries([...new Set(' ABé.')].map(character => [character, { x: 0, y: 0, width: character === ' ' ? 3 : 5, height: 14, advance: character === ' ' ? 3 : 6 }])),
};

describe('bitmap dialogue layout', () => {
  it('uses source advances and keeps explicit line breaks and Unicode glyphs', () => {
    expect(layoutDialogue('A é\nB.', font).glyphs).toEqual([
      { character: 'A', x: 0, y: 0 }, { character: ' ', x: 6, y: 0 }, { character: 'é', x: 9, y: 0 },
      { character: 'B', x: 0, y: 15 }, { character: '.', x: 6, y: 15 },
    ]);
  });
  it('wraps whole words and long unsupported explanations without clipping', () => {
    const layout = layoutDialogue('AB ABAB', font, 18);
    expect(layout.glyphs.filter(glyph => glyph.character !== ' ').map(({ x, y }) => [x, y])).toEqual([[0, 0], [6, 0], [0, 15], [6, 15], [12, 15], [0, 30]]);
    expect(layout.height).toBe(45);
  });
  it('rejects missing glyphs instead of silently substituting browser text', () => {
    expect(() => layoutDialogue('A🙂', font)).toThrow('missing glyph');
  });
});
