import { dialogueFontSchema, type DialogueFont } from '@pokewaterblue/content-schema';

export interface PlacedGlyph { character: string; x: number; y: number }
export function layoutDialogue(text: string, font: DialogueFont, width = 216): { glyphs: PlacedGlyph[]; height: number } {
  const glyphs: PlacedGlyph[] = [];
  let x = 0, y = 0;
  const advance = (character: string) => {
    const glyph = font.glyphs[character];
    if (!glyph) throw new Error(`Dialogue font is missing glyph ${JSON.stringify(character)}. Rebuild content.`);
    return glyph.advance + font.letterSpacing;
  };
  const newline = () => { x = 0; y += font.lineHeight; };
  for (const token of text.split(/(\n| +)/)) {
    if (!token) continue;
    if (token === '\n') { newline(); continue; }
    const characters = [...token];
    const tokenWidth = characters.reduce((sum, character) => sum + advance(character), 0);
    if (x > 0 && x + tokenWidth > width) { newline(); if (/^ +$/.test(token)) continue; }
    for (const character of characters) {
      const step = advance(character), glyph = font.glyphs[character]!;
      if (step > width || glyph.width > width) throw new Error('Dialogue glyph is wider than the text window.');
      if (x + Math.max(step, glyph.width) > width) newline();
      glyphs.push({ character, x, y }); x += step;
    }
  }
  return { glyphs, height: Math.max(2 * font.lineHeight, y + font.lineHeight) };
}

export async function loadDialogueFont(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Dialogue font metadata is missing. Rebuild content.');
  const font = dialogueFontSchema.parse(await response.json());
  const atlas = new Image();
  atlas.src = font.image;
  try { await atlas.decode(); }
  catch { throw new Error('Dialogue font image could not be loaded. Rebuild content.'); }
  if (atlas.naturalWidth !== font.atlasWidth || atlas.naturalHeight !== font.atlasHeight) throw new Error('Dialogue font image dimensions do not match its metadata. Rebuild content.');
  return {
    font,
    draw(canvas: HTMLCanvasElement, text: string) {
      const layout = layoutDialogue(text, font);
      canvas.width = 216; canvas.height = layout.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('The dialogue canvas is unavailable.');
      context.imageSmoothingEnabled = false;
      for (const placed of layout.glyphs) {
        const glyph = font.glyphs[placed.character]!;
        context.drawImage(atlas, glyph.x, glyph.y, glyph.width, glyph.height, placed.x, placed.y, glyph.width, glyph.height);
      }
      canvas.style.width = 'calc(216px * var(--pixel-scale, 1))';
      canvas.style.height = `calc(${layout.height}px * var(--pixel-scale, 1))`;
      canvas.dataset.font = font.id;
    },
  };
}
