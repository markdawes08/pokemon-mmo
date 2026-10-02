"""Standalone pinned battle sprites; does not change field/world content hashes."""
from __future__ import annotations
import argparse
import io
import json
from pathlib import Path
import re
import tempfile

from PIL import Image, __version__ as pillow_version
from import_content import ROOT, Source, json_bytes, palette_from_jasc, require, sha

SPECIES = ((7, 'Squirtle'), (8, 'Wartortle'), (9, 'Blastoise'), (16, 'Pidgey'),
           (17, 'Pidgeotto'), (18, 'Pidgeot'), (19, 'Rattata'), (20, 'Raticate'))
MANIFEST = 'manifests/practice-sprites-manifest.json'


def source_context():
    lock = json.loads((ROOT / 'source-lock.json').read_text(encoding='utf-8-sig'))
    manifest = json.loads((ROOT / lock['fingerprint']['manifest']).read_text(encoding='utf-8-sig'))
    records = manifest['records']
    require(len({r['path'] for r in records}) == len(records), 'Duplicate source paths')
    digest = sha(''.join(f"{r['sha256']}  {r['size']}  {r['path']}\n" for r in sorted(records, key=lambda r: r['path'])).encode())
    require(digest == manifest['sourceFingerprint'] == lock['fingerprint']['value'], 'Source fingerprint differs')
    require(lock['selectedBuild'] == {'game': 'FIRERED', 'revision': 0, 'language': 'ENGLISH', 'evidence': 'config.mk:3-5'}, 'Unsupported source build')
    return Source(Path(lock['reference']['localPath']), {r['path']: r for r in records}), digest


def coordinates(text: str, symbol: str):
    match = re.search(r'\[SPECIES_' + symbol + r'\]\s*=\s*\{\s*\.size\s*=\s*MON_COORDS_SIZE\((\d+),\s*(\d+)\),\s*\.y_offset\s*=\s*(\d+),\s*\}', text)
    require(match is not None, f'Missing source coordinates: {symbol}')
    width, height, offset = map(int, match.groups())
    require(0 < width <= 64 and 0 < height <= 64 and 0 <= offset <= 32, 'Invalid sprite coordinates')
    return {'width': 64, 'height': 64, 'bodyWidth': width, 'bodyHeight': height, 'yOffset': offset}


def build(output: Path):
    require(pillow_version == '11.3.0', 'Expected pinned Pillow 11.3.0')
    source, fingerprint = source_context()
    graphics = source.text('src/data/graphics/pokemon.h')
    palette_table = source.text('src/data/pokemon_graphics/palette_table.h')
    tables = {face: source.text(f'src/data/pokemon_graphics/{face}_pic_table.h') for face in ('front', 'back')}
    coords = {face: source.text(f'src/data/pokemon_graphics/{face}_pic_coordinates.h') for face in ('front', 'back')}
    elevation = source.text('src/data/pokemon_graphics/enemy_mon_elevation.h')
    emitted = []

    def put(relative, data):
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        emitted.append({'path': relative, 'bytes': len(data), 'sha256': sha(data)})

    rows = []
    for species_id, name in SPECIES:
        symbol, directory = name.upper(), name.lower()
        require(f'SPECIES_PAL({symbol}, gMonPalette_{name})' in palette_table, 'Palette binding differs')
        require(f'gMonPalette_{name}[] = INCBIN_U32("graphics/pokemon/{directory}/normal.gbapal.lz")' in graphics, 'Palette source path differs')
        palette = palette_from_jasc(source.text(f'graphics/pokemon/{directory}/normal.pal'), name)
        row = {'speciesId': species_id}
        for face in ('front', 'back'):
            title = face.title()
            require(f'SPECIES_SPRITE({symbol}, gMon{title}Pic_{name})' in tables[face], 'Sprite binding differs')
            require(f'gMon{title}Pic_{name}[] = INCBIN_U32("graphics/pokemon/{directory}/{face}.4bpp.lz")' in graphics, 'Sprite source path differs')
            image = source.image(f'graphics/pokemon/{directory}/{face}.png')
            require(image.mode == 'P' and image.size == (64, 64), 'Expected source indexed 64x64 sprite')
            pixels = list(image.getdata())
            require(all(type(pixel) is int and 0 <= pixel < 16 for pixel in pixels), 'Sprite exceeds source 4bpp palette')
            rendered = Image.new('RGBA', image.size)
            rendered.putdata([palette[pixel] for pixel in pixels])
            buffer = io.BytesIO()
            rendered.save(buffer, format='PNG', optimize=False, compress_level=9)
            relative = f'client/practice/sprites/{species_id}-{face}.png'
            put(relative, buffer.getvalue())
            row[face] = {'url': '/' + relative.replace('client/', 'content/', 1), **coordinates(coords[face], symbol)}
        match = re.search(r'\[SPECIES_' + symbol + r'\]\s*=\s*(\d+)', elevation)
        row['enemyElevation'] = int(match[1]) if match else 0
        rows.append(row)
    put('client/practice/sprites.json', json_bytes({'schemaVersion': 1, 'sourceFingerprint': fingerprint, 'species': rows}))
    manifest = {'schemaVersion': 1, 'sourceFingerprint': fingerprint, 'generator': 'tools/content-import/practice_sprites.py',
                'generatorSha256': sha(Path(__file__).read_bytes()), 'pillowVersion': pillow_version,
                'sharedRendererSha256': sha(Path(__file__).with_name('import_content.py').read_bytes()),
                'inputs': sorted(source.inputs.values(), key=lambda r: r['path']), 'outputs': sorted(emitted, key=lambda r: r['path']),
                'scope': 'Eight normal-color source front/back battle sprites; static presentation, no original battle animation interpreter.'}
    target = output / MANIFEST
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(json_bytes(manifest))
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=('build', 'check'))
    args = parser.parse_args()
    output = ROOT / 'content/generated'
    if args.command == 'build':
        result = build(output)
    else:
        result = json.loads((output / MANIFEST).read_text())
        for row in result['outputs']:
            relative = Path(row['path'])
            require(not relative.is_absolute() and '..' not in relative.parts, 'Unsafe practice output path')
            target = (output / relative).resolve()
            require(target.is_relative_to(output.resolve()) and sha(target.read_bytes()) == row['sha256'], 'Practice sprite output differs')
        with tempfile.TemporaryDirectory(prefix='pokewaterblue-practice-sprites-') as temporary:
            rebuilt = build(Path(temporary))
            require(json_bytes(result) == json_bytes(rebuilt), 'Practice sprites are not reproducible')
    print(json.dumps({'status': 'passed', 'outputs': len(result['outputs']), 'sourceInputs': len(result['inputs']), 'sourceFingerprint': result['sourceFingerprint']}))


if __name__ == '__main__':
    main()
