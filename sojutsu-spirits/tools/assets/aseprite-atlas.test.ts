/**
 * The packer's contract, tested on synthetic frames only — no image files, no network.
 *
 * The properties here are the ones a broken atlas fails silently on: a frame that overlaps
 * another shows a neighbour's pixels down one edge, a frame that falls outside the sheet reads
 * as transparent, and a frame whose trim offset is wrong is drawn a few pixels off its own
 * origin. None of those throw at runtime — they just make the game look subtly wrong — so they
 * are asserted here instead.
 */
import { describe, expect, it } from 'vitest';

import {
  isPowerOfTwo,
  packAtlas,
  validateAtlas,
  type AsepriteAtlas,
  type FrameInput,
} from './aseprite-atlas.ts';
import { blankImage, type RawImage } from './pixel-ops.ts';

/** A solid block of one colour, optionally inset inside a transparent margin. */
function block(width: number, height: number, colour: number, inset = 0): RawImage {
  const img = blankImage(width, height);
  for (let y = inset; y < height - inset; y++) {
    for (let x = inset; x < width - inset; x++) {
      const i = (y * width + x) * 4;
      img.data[i] = colour;
      img.data[i + 1] = 255 - colour;
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  return img;
}

function sampleFrames(): FrameInput[] {
  return [
    { name: 'ui/keypad-key', image: block(152, 64, 10) },
    { name: 'ui/joystick-base', image: block(192, 192, 20) },
    { name: 'dex/069-fawnix', image: block(128, 128, 30) },
    { name: 'dex/070-vulpine', image: block(128, 128, 40) },
    { name: 'tiles/grass-0', image: block(32, 32, 50) },
    { name: 'tiles/grass-1', image: block(32, 32, 60) },
    { name: 'player/idle-south', image: block(48, 48, 70) },
    { name: 'player/walk-east-0', image: block(48, 48, 80) },
    { name: 'ui/bar-frame-hp', image: block(200, 18, 90) },
  ];
}

/** Re-read the atlas the way Phaser would: through JSON, not through the in-memory object. */
function roundTrip(atlas: AsepriteAtlas): AsepriteAtlas {
  return JSON.parse(JSON.stringify(atlas)) as AsepriteAtlas;
}

describe('packAtlas', () => {
  it('round-trips every frame name through the JSON', async () => {
    const frames = sampleFrames();
    const packed = await packAtlas('test', frames);
    const atlas = roundTrip(packed.atlas);

    expect(Object.keys(atlas.frames).sort()).toEqual(frames.map((f) => f.name).sort());
    for (const f of frames) {
      const record = atlas.frames[f.name];
      expect(record, `frame ${f.name} missing`).toBeDefined();
      expect(record!.sourceSize).toEqual({ w: f.image.width, h: f.image.height });
      expect(record!.rotated).toBe(false);
    }
  });

  it('places every frame inside the sheet and never overlaps two frames', async () => {
    const packed = await packAtlas('test', sampleFrames());
    const atlas = roundTrip(packed.atlas);

    expect(validateAtlas(atlas, packed.order)).toEqual([]);

    // Asserted independently of validateAtlas, so a bug in the validator cannot hide a bug in
    // the packer.
    const rects = Object.entries(atlas.frames).map(([name, f]) => ({ name, ...f.frame }));
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(atlas.meta.size.w);
      expect(r.y + r.h).toBeLessThanOrEqual(atlas.meta.size.h);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        const overlaps =
          a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlaps, `${a.name} overlaps ${b.name}`).toBe(false);
      }
    }
  });

  it('emits a power-of-two sheet and a matching PNG', async () => {
    const packed = await packAtlas('test', sampleFrames());
    expect(isPowerOfTwo(packed.sheet.w)).toBe(true);
    expect(isPowerOfTwo(packed.sheet.h)).toBe(true);
    expect(packed.atlas.meta.size).toEqual(packed.sheet);
    expect(packed.atlas.meta.image).toBe('test.png');
    expect(packed.atlas.meta.format).toBe('RGBA8888');
    // PNG magic — the sheet really is a PNG, not a raw buffer.
    expect([...packed.png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('records the trim offset so a trimmed frame still draws at its own origin', async () => {
    const inset = 12;
    const packed = await packAtlas('test', [{ name: 'a', image: block(64, 64, 100, inset) }], {
      trim: true,
    });
    const record = packed.atlas.frames['a']!;

    expect(record.trimmed).toBe(true);
    expect(record.sourceSize).toEqual({ w: 64, h: 64 });
    expect(record.spriteSourceSize.x).toBe(inset);
    expect(record.spriteSourceSize.y).toBe(inset);
    expect(record.frame.w).toBe(64 - inset * 2);
    expect(record.frame.h).toBe(64 - inset * 2);
  });

  it('leaves untrimmed frames at full size, which is what keeps terrain tileable', async () => {
    const packed = await packAtlas('tiles', [{ name: 'grass', image: block(32, 32, 5, 4) }], {
      trim: false,
    });
    const record = packed.atlas.frames['grass']!;
    expect(record.trimmed).toBe(false);
    expect(record.frame.w).toBe(32);
    expect(record.frame.h).toBe(32);
    expect(record.spriteSourceSize).toEqual({ x: 0, y: 0, w: 32, h: 32 });
  });

  it('keeps frame order stable so frameTags address the right frames', async () => {
    const frames = sampleFrames();
    const tags = [{ name: 'walk', from: 6, to: 7, direction: 'forward' as const }];
    const packed = await packAtlas('test', frames, { frameTags: tags });

    expect(packed.order).toEqual(frames.map((f) => f.name));
    expect(Object.keys(packed.atlas.frames)).toEqual(packed.order);
    expect(packed.atlas.meta.frameTags).toEqual(tags);
    expect(validateAtlas(packed.atlas, packed.order)).toEqual([]);
  });

  it('is deterministic: the same frames pack to the same sheet twice', async () => {
    const a = await packAtlas('test', sampleFrames(), { trim: true });
    const b = await packAtlas('test', sampleFrames(), { trim: true });
    expect(JSON.stringify(a.atlas)).toBe(JSON.stringify(b.atlas));
    expect(a.png.equals(b.png)).toBe(true);
  });

  it('rejects duplicate frame names rather than silently dropping one', async () => {
    await expect(
      packAtlas('test', [
        { name: 'dup', image: block(8, 8, 1) },
        { name: 'dup', image: block(8, 8, 2) },
      ]),
    ).rejects.toThrow(/duplicate frame/);
  });

  it('refuses to pack more than the maximum sheet can hold', async () => {
    const frames: FrameInput[] = Array.from({ length: 8 }, (_, i) => ({
      name: `big-${i}`,
      image: blankImage(64, 64),
    }));
    await expect(packAtlas('test', frames, { maxSize: 64, padding: 0 })).rejects.toThrow(/do not fit/);
  });
});

describe('validateAtlas', () => {
  it('reports an overlap that the packer would never produce', async () => {
    const packed = await packAtlas('test', sampleFrames());
    const atlas = roundTrip(packed.atlas);
    const first = packed.order[0]!;
    const second = packed.order[1]!;
    // Force the two frames on top of one another.
    (atlas.frames[second]! as { frame: { x: number; y: number } }).frame = {
      ...atlas.frames[second]!.frame,
      x: atlas.frames[first]!.frame.x,
      y: atlas.frames[first]!.frame.y,
    };

    const problems = validateAtlas(atlas, packed.order);
    expect(problems.some((p) => p.includes('overlap'))).toBe(true);
  });

  it('reports a frame that hangs off the edge of the sheet', async () => {
    const packed = await packAtlas('test', sampleFrames());
    const atlas = roundTrip(packed.atlas);
    const name = packed.order[0]!;
    (atlas.frames[name]! as { frame: { x: number } }).frame = {
      ...atlas.frames[name]!.frame,
      x: atlas.meta.size.w - 1,
    };

    expect(validateAtlas(atlas, packed.order).some((p) => p.includes('outside'))).toBe(true);
  });

  it('reports a tag that addresses a frame index that does not exist', async () => {
    const packed = await packAtlas('test', sampleFrames(), {
      frameTags: [{ name: 'bad', from: 0, to: 999, direction: 'forward' }],
    });
    expect(validateAtlas(packed.atlas, packed.order).some((p) => p.includes('tag "bad"'))).toBe(true);
  });
});
