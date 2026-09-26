import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dialogueFontSchema, palletMapSchema, previewAudioSchema, worldManifestSchema, worldMapSchema } from "./index";

const fixture = palletMapSchema.parse(JSON.parse(readFileSync("content/generated/client/maps/PalletTown.json", "utf8")));
const world = worldManifestSchema.parse(JSON.parse(readFileSync("content/generated/client/world.json", "utf8")));
const font = dialogueFontSchema.parse(JSON.parse(readFileSync("content/generated/client/fonts/dialogue.json", "utf8")));
const audio = previewAudioSchema.parse(JSON.parse(readFileSync("content/generated/client/audio/preview.json", "utf8")));

describe("renderer content boundary", () => {
  it("rejects unsafe audio samples, missing voices and loops outside sample bounds", () => {
    const missingVoice = structuredClone(audio);
    missingVoice.music.tracks[0]!.notes[0]!.voice = "voicegroup999:99";
    expect(previewAudioSchema.safeParse(missingVoice).success).toBe(false);
    const unsafeSample = structuredClone(audio);
    const sample = Object.values(unsafeSample.voices).find(voice => voice.kind === "sample")!;
    sample.url = "https://example.com/instrument.wav";
    expect(previewAudioSchema.safeParse(unsafeSample).success).toBe(false);
    const outside = structuredClone(audio);
    const looping = Object.values(outside.voices).find(voice => voice.kind === "sample")!;
    looping.loopEnd = looping.frames / looping.sampleRate + 1;
    expect(previewAudioSchema.safeParse(outside).success).toBe(false);
    const unordered = structuredClone(audio);
    unordered.soundEffect.tracks[0]!.controls[0]!.time = 1;
    expect(previewAudioSchema.safeParse(unordered).success).toBe(false);
  });
  it("requires safe font paths and in-bounds source glyphs before drawing", () => {
    const outside = structuredClone(font);
    outside.glyphs["é"]!.x = font.atlasWidth;
    expect(dialogueFontSchema.safeParse(outside).success).toBe(false);
    const invisible = structuredClone(font);
    Reflect.deleteProperty(invisible.glyphs, " ");
    expect(dialogueFontSchema.safeParse(invisible).success).toBe(false);
    const unsafe = structuredClone(font);
    unsafe.image = "https://example.com/font.png";
    expect(dialogueFontSchema.safeParse(unsafe).success).toBe(false);
    const missing = structuredClone(world);
    Reflect.deleteProperty(missing, "dialogueFont");
    expect(worldManifestSchema.safeParse(missing).success).toBe(false);
  });
  it("accepts the pinned generated content", () => {
    expect(palletMapSchema.safeParse(fixture).success).toBe(true);
    expect(world.maps).toHaveLength(3);
    for (const map of world.maps) {
      const parsed = worldMapSchema.parse(JSON.parse(readFileSync(`content/generated/client/maps/${map.name}.json`, "utf8")));
      expect(parsed.id).toBe(map.id);
      expect(parsed.displayName).toBe(map.displayName);
    }
  });

  it("rejects duplicate or absent world identities and unsafe map requests", () => {
    const duplicate = structuredClone(world);
    duplicate.maps.push(duplicate.maps[0]!);
    expect(worldManifestSchema.safeParse(duplicate).success).toBe(false);
    const absent = structuredClone(world);
    absent.startMap = "MAP_MISSING";
    expect(worldManifestSchema.safeParse(absent).success).toBe(false);
    const unsafe = structuredClone(world);
    unsafe.maps[0]!.url = "/content/../private/map.json";
    expect(worldManifestSchema.safeParse(unsafe).success).toBe(false);
  });

  it("rejects inconsistent source warp indices and destination availability", () => {
    const index = structuredClone(fixture);
    index.events.warps[0]!.warpId = 2;
    expect(worldMapSchema.safeParse(index).success).toBe(false);
    const unresolved = structuredClone(fixture);
    unresolved.events.warps[0]!.destination = null;
    expect(worldMapSchema.safeParse(unresolved).success).toBe(false);
    const outside = structuredClone(fixture);
    outside.events.warps[0]!.x = outside.width;
    expect(worldMapSchema.safeParse(outside).success).toBe(false);
  });

  it("requires visible NPC graphics and valid actor animation frame references", () => {
    const missing = structuredClone(fixture);
    missing.actorGraphics = [];
    expect(worldMapSchema.safeParse(missing).success).toBe(false);
    const badFrame = structuredClone(fixture);
    badFrame.actorGraphics[0]!.animations["idle-south"][0]!.frame = 9;
    expect(worldMapSchema.safeParse(badFrame).success).toBe(false);
    const duplicate = structuredClone(fixture);
    duplicate.events.objects[1]!.localId = duplicate.events.objects[0]!.localId;
    expect(worldMapSchema.safeParse(duplicate).success).toBe(false);
  });

  it("rejects empty dialogue and prevents unavailable interactions containing partial messages", () => {
    const empty = structuredClone(fixture);
    empty.events.objects[1]!.interaction = { kind: "dialogue", pages: [] };
    expect(worldMapSchema.safeParse(empty).success).toBe(false);
    const truncated = structuredClone(fixture);
    truncated.events.objects[0]!.interaction = { kind: "unavailable", reason: "Needs story state", pages: ["An unearned reward"] };
    expect(worldMapSchema.safeParse(truncated).success).toBe(false);
  });

  it("rejects missing or empty animation sequences before the renderer uses them", () => {
    for (const key of Object.keys(fixture.player.animations)) {
      const missing = structuredClone(fixture);
      Reflect.deleteProperty(missing.player.animations, key);
      expect(palletMapSchema.safeParse(missing).success, `missing ${key}`).toBe(false);
      const empty = structuredClone(fixture);
      Reflect.set(empty.player.animations, key, []);
      expect(palletMapSchema.safeParse(empty).success, `empty ${key}`).toBe(false);
    }
  });

  it("rejects malformed frame references and map dimensions", () => {
    const frame = structuredClone(fixture);
    frame.player.animations["walk-east"][0]!.frame = 18;
    expect(palletMapSchema.safeParse(frame).success).toBe(false);
    const blocks = structuredClone(fixture);
    blocks.blocks.pop();
    expect(palletMapSchema.safeParse(blocks).success).toBe(false);
    const spawn = structuredClone(fixture);
    spawn.previewSpawn.x = fixture.width;
    expect(palletMapSchema.safeParse(spawn).success).toBe(false);
  });

  it("restricts every fetchable image to a generated same-origin content path", () => {
    const invalidUrls = [
      "https://example.com/map.png", "//example.com/map.png", "data:image/png;base64,AA==",
      "/content/../private/map.png", "/content/%2e%2e/private/map.png",
      "/content/maps/PalletTown/top.png?redirect=1", "/content/maps\\top.png",
    ];
    for (const url of invalidUrls) {
      const layer = structuredClone(fixture);
      layer.layers.top = url;
      expect(palletMapSchema.safeParse(layer).success, `layer ${url}`).toBe(false);
      const sprite = structuredClone(fixture);
      sprite.player.image = url;
      expect(palletMapSchema.safeParse(sprite).success, `sprite ${url}`).toBe(false);
      const animated = structuredClone(fixture);
      animated.animations[0]!.frames[0]!.middle = url;
      expect(palletMapSchema.safeParse(animated).success, `animation ${url}`).toBe(false);
      const border = structuredClone(fixture);
      border.border.layers.middle = url;
      expect(worldMapSchema.safeParse(border).success, `border ${url}`).toBe(false);
      const door = structuredClone(fixture);
      door.doors[0]!.frames[0] = url;
      expect(worldMapSchema.safeParse(door).success, `door ${url}`).toBe(false);
      const actor = structuredClone(fixture);
      actor.actorGraphics[0]!.image = url;
      expect(worldMapSchema.safeParse(actor).success, `actor ${url}`).toBe(false);
    }
  });
});
