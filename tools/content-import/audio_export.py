"""Bounded source-sequence/sample export for the Pallet and select prototypes.

This is not an MPlay emulator. The pinned assembly is read as a sequence (with
running commands); samples come from canonical WAV files, not generated .bin.
Only the commands and voice kinds needed by these two pieces are accepted.
"""
from __future__ import annotations

import ast
import re
import struct

LENGTHS = set(range(1, 25)) | {28, 30, 32, 36, 40, 42, 44, 48, 52, 54, 56, 60, 64, 66, 68, 72, 76, 78, 80, 84, 88, 90, 92, 96}


class AudioError(ValueError):
    pass


def check(ok: bool, message: str) -> None:
    if not ok:
        raise AudioError(message)


def expression(text: str, constants: dict[str, int]) -> int:
    def visit(node):
        if isinstance(node, ast.Constant) and isinstance(node.value, int):
            return node.value
        if isinstance(node, ast.Name) and node.id in constants:
            return constants[node.id]
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            return visit(node.operand) * (-1 if isinstance(node.op, ast.USub) else 1)
        if isinstance(node, ast.BinOp):
            left, right = visit(node.left), visit(node.right)
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            if isinstance(node.op, ast.Div) and right:
                return left // right
        raise AudioError(f"Unsupported audio expression: {text}")
    return visit(ast.parse(text, mode="eval").body)


def sequence(text: str, name: str) -> dict:
    constants = {"mxv": 127, "c_v": 64, "reverb_set": 128}
    group = re.search(rf"\.equ\s+{name}_grp,\s*(voicegroup\d+)", text)
    check(group is not None, f"{name}: missing voice group")
    for key, value in re.findall(r"\.equ\s+(\w+),\s*([^\n]+)", text):
        if key != f"{name}_grp":
            constants[key] = expression(value.strip(), constants)
    names = re.findall(rf"^({name}_\d+):", text, re.M)
    check(names and len(set(names)) == len(names), f"{name}: missing/duplicate tracks")
    header = text.split(f"\n{name}:", 1)[-1]
    header_tracks = re.findall(rf"\.word\s+({name}_\d+)\b", header)
    check(header_tracks == names, f"{name}: track header mismatch")
    count = re.search(r"\.byte\s+(\d+)", header)
    check(count is not None and int(count[1]) == len(names), f"{name}: track count mismatch")
    check(constants[f"{name}_key"] == 0 and constants[f"{name}_tbs"] == 1,
          f"{name}: unsupported transpose/timebase")
    controls = {"VOL": "volume", "PAN": "pan", "BEND": "bend", "BENDR": "bendRange",
                "LFOS": "lfoSpeed", "MOD": "modulation"}
    tracks, tempos = [], []
    for track_index, track_name in enumerate(names):
        end = names[track_index + 1] if track_index + 1 < len(names) else name
        body = text.split(f"\n{track_name}:", 1)[1].split(f"\n{end}:", 1)[0]
        tick, voice, duration, key, velocity = 0, None, None, None, None
        state = {"volume": 127, "pan": 0, "bend": 0, "bendRange": 2,
                 "lfoSpeed": 22, "modulation": 0}
        notes, changes, labels = [], [{"tick": 0, **state}], {}
        running, loop_start, ended = None, None, False
        lines = body.splitlines()
        for index, raw in enumerate(lines):
            line = raw.split("@", 1)[0].strip()
            if not line or line.startswith(".align"):
                continue
            if line.endswith(":"):
                labels[line[:-1]] = tick
                continue
            check(line.startswith(".byte"), f"{track_name}: unsupported directive {line}")
            args = [value.strip() for value in line[5:].strip().split(",")]
            token = args[0]
            if re.fullmatch(r"W\d+", token):
                check(len(args) == 1 and int(token[1:]) in LENGTHS | {0}, f"{track_name}: invalid wait")
                tick += int(token[1:])
                continue
            if token == "GOTO":
                target = next((row.split("@", 1)[0].strip() for row in lines[index + 1:]
                               if row.split("@", 1)[0].strip()), "")
                match = re.fullmatch(r"\.word\s+(\w+)", target)
                check(match is not None and match[1] in labels, f"{track_name}: unsupported loop target")
                loop_start, ended = labels[match[1]], True
                break
            if token == "FINE":
                ended = True
                break
            if re.fullmatch(r"N\d+", token):
                duration = int(token[1:])
                check(duration in LENGTHS, f"{track_name}: invalid note length")
                running, args = "NOTE", args[1:]
            elif token in (*controls, "VOICE", "KEYSH", "TEMPO"):
                running, args = token, args[1:]
            elif not (re.fullmatch(r"[A-G][ns][0-9]", token) or re.match(r"[0-9+-]|c_v", token)):
                raise AudioError(f"{track_name}: unsupported audio command {token}")
            if running == "NOTE":
                if args:
                    match = re.fullmatch(r"([A-G])([ns])([0-9])", args[0])
                    check(match is not None, f"{track_name}: invalid note {args[0]}")
                    key = 12 * (int(match[3]) + 2) + {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}[match[1]] + (match[2] == "s")
                if len(args) > 1:
                    check(re.fullmatch(r"v\d{3}", args[1]) is not None, "Unsupported note velocity")
                    velocity = int(args[1][1:])
                check(len(args) <= 2 and all(value is not None for value in (voice, key, velocity, duration)),
                      f"{track_name}: unsupported/incomplete note")
                check(0 <= key <= 127 and 1 <= velocity <= 127 and duration > 0, f"{track_name}: note outside range")
                notes.append({"tick": tick, "ticks": duration, "key": key, "velocity": velocity, "program": voice})
            else:
                check(len(args) == 1 and running is not None, f"{track_name}: invalid control")
                value = expression(args[0], constants)
                if running == "VOICE":
                    check(0 <= value < 128, "Invalid voice")
                    voice = value
                elif running == "KEYSH":
                    check(value == 0, "Unsupported key shift")
                elif running == "TEMPO":
                    check(tick == 0 and 0 < value <= 255, "Only fixed initial tempo supported")
                    tempos.append(value * 2)
                else:
                    check(running in controls and 0 <= value <= 127, "Unsupported audio control range")
                    state[controls[running]] = value - 64 if running in ("PAN", "BEND") else value
                    if changes[-1]["tick"] == tick:
                        changes[-1] = {"tick": tick, **state}
                    else:
                        changes.append({"tick": tick, **state})
        check(ended and notes and tick > 0, f"{track_name}: missing end or empty track")
        check(all(note["tick"] + note["ticks"] <= tick for note in notes), f"{track_name}: notes cross loop/end")
        tracks.append({"notes": notes, "controls": changes, "endTick": tick, "loopTick": loop_start})
    check(tempos and len(set(tempos)) == 1, f"{name}: missing/conflicting tempo")
    check(len({track["endTick"] for track in tracks}) == 1, f"{name}: differing track durations")
    check(len({track["loopTick"] for track in tracks}) == 1, f"{name}: differing track loop points")
    seconds = 60 / (tempos[0] * 24)
    end_tick, loop_tick = tracks[0]["endTick"], tracks[0]["loopTick"]
    for track in tracks:
        for note in track["notes"]:
            note["time"], note["duration"] = note.pop("tick") * seconds, note.pop("ticks") * seconds
        for change in track["controls"]:
            change["time"] = change.pop("tick") * seconds
        del track["endTick"], track["loopTick"]
    return {"id": name.upper(), "voiceGroup": group[1], "tempo": tempos[0], "ticksPerBeat": 24,
            "sourceReverb": constants[f"{name}_rev"] - 128,
            "duration": end_tick * seconds, "loopStart": None if loop_tick is None else loop_tick * seconds,
            "loopEnd": None if loop_tick is None else end_tick * seconds, "tracks": tracks}


def wav_metadata(data: bytes) -> dict:
    check(data[:4] == b"RIFF" and data[8:12] == b"WAVE", "Sample is not RIFF WAVE")
    check(struct.unpack_from("<I", data, 4)[0] + 8 == len(data), "Truncated WAVE")
    chunks, offset = {}, 12
    while offset < len(data):
        check(offset + 8 <= len(data), "Truncated WAVE chunk")
        tag, size = struct.unpack_from("<4sI", data, offset)
        check(offset + 8 + size <= len(data) and tag not in chunks, "Truncated/duplicate WAVE chunk")
        chunks[tag] = data[offset + 8:offset + 8 + size]
        offset += 8 + size + size % 2
    check(all(tag in chunks for tag in (b"fmt ", b"data", b"smpl", b"agbp", b"agbl")), "Missing source WAVE metadata")
    check(len(chunks[b"fmt "]) == 16 and len(chunks[b"smpl"]) == 60 and
          len(chunks[b"agbp"]) == len(chunks[b"agbl"]) == 4, "Unsupported WAVE metadata size")
    fmt = struct.unpack("<HHIIHH", chunks[b"fmt "])
    check(fmt[0:2] == (1, 1) and fmt[4:] == (1, 8), "Only source mono PCM8 WAV supported")
    smpl = struct.unpack("<15I", chunks[b"smpl"])
    check(smpl[4] == 0 and smpl[7] == 1 and smpl[10] == 0, "Unsupported sample tuning/loop")
    end = struct.unpack("<I", chunks[b"agbl"])[0]
    pitch = struct.unpack("<I", chunks[b"agbp"])[0]
    check(0 <= smpl[11] < end <= len(chunks[b"data"]) and fmt[2] > 0 and pitch > 0, "Invalid sample loop/pitch")
    return {"sampleRate": fmt[2], "sourceRate": pitch / 1024, "rootKey": smpl[3],
            "loopStart": smpl[11] / fmt[2], "loopEnd": end / fmt[2], "frames": len(chunks[b"data"])}


def export_audio(source, put) -> dict:
    text = lambda path: source.read(path).decode("utf-8")
    groups = text("sound/voice_groups.inc")
    splits = text("sound/keysplit_tables.inc")
    direct = text("sound/direct_sound_data.inc")
    # Evidence for sequence constants, MIDI export options, ADSR, pitch, and WAV overrides.
    definitions = text("sound/MPlayDef.s")
    for name, number in (("mxv", "0x7F"), ("c_v", "0x40"), ("Cn3", "60")):
        check(re.search(rf"\.equ\s+{name},\s*{number}\s", definitions) is not None, f"Unsupported MPlay constant {name}")
    cfg = text("sound/songs/midi/midi.cfg")
    for name, options in (("mus_pallet", "-E -R50 -G159 -V100"), ("se_select", "-E -R50 -G127 -V080 -P5")):
        check(re.search(rf"^{name}\.mid:\s*{re.escape(options)}\s*$", cfg, re.M) is not None, f"Unsupported MIDI settings for {name}")
    for path in ("asm/macros/music_voice.inc",
                 "src/m4a.c", "tools/wav2agb/wav_file.cpp", "tools/wav2agb/converter.cpp"):
        source.read(path)
    voices, samples = {}, {}

    def voice(group: str, program: int, key: int) -> str:
        match = re.search(rf"^{group}::\n(.*?)(?=^\s*\.align|\Z)", groups, re.M | re.S)
        check(match is not None, f"Missing audio group {group}")
        rows = [row.strip() for row in match[1].splitlines() if row.strip()]
        check(0 <= program < len(rows), f"Voice {group}:{program} out of range")
        kind, args = rows[program].split(" ", 1)
        args = [arg.strip() for arg in args.split(",")]
        if kind == "voice_keysplit":
            check(len(args) == 2, "Invalid keysplit")
            table = re.search(rf"\.set {args[1]}, \. - (\d+)\n(.*?)(?=\.set|\Z)", splits, re.S)
            check(table is not None, "Missing keysplit table")
            entries = [int(value) for value in re.findall(r"\.byte (\d+)", table[2])]
            index = key - int(table[1])
            check(0 <= index < len(entries), "Note outside keysplit table")
            return voice(args[0], entries[index], key)
        identity = f"{group}:{program}"
        if identity in voices:
            return identity
        if kind == "voice_directsound":
            check(len(args) == 7 and args[1] == "0", "Unsupported sample voice")
            sample = re.fullmatch(r"DirectSoundWaveData_(\w+)", args[2])
            check(sample is not None, "Invalid sample identity")
            name = sample[1]
            check(re.search(rf'{args[2]}::\s+\.incbin "sound/direct_sound_samples/{name}\.bin"', direct) is not None,
                  "Sample pointer does not match canonical WAV")
            if name not in samples:
                raw = source.read(f"sound/direct_sound_samples/{name}.wav")
                samples[name] = wav_metadata(raw)
                put(f"client/audio/samples/{name}.wav", raw)
            voices[identity] = {"kind": "sample", "url": f"/content/audio/samples/{name}.wav",
                                "envelope": [int(arg) for arg in args[3:]], **samples[name]}
            check(int(args[0]) == samples[name]["rootKey"] == 60, "Unsupported sample root key")
        elif kind in ("voice_square_1_alt", "voice_square_2_alt"):
            values = [int(arg) for arg in args]
            square1 = kind == "voice_square_1_alt"
            check(len(values) == (8 if square1 else 7) and values[:2] == [60, 0], "Unsupported square voice")
            voices[identity] = {"kind": "square", "duty": [0.125, 0.25, 0.5, 0.75][values[3 if square1 else 2]],
                                "sweep": values[2] if square1 else 0, "envelope": values[-4:]}
        else:
            raise AudioError(f"Unsupported required voice kind {kind}")
        return identity

    songs = []
    for name in ("mus_pallet", "se_select"):
        source.read(f"sound/songs/midi/{name}.mid")
        song = sequence(text(f"sound/songs/midi/{name}.s"), name)
        for track in song["tracks"]:
            for note in track["notes"]:
                note["voice"] = voice(song["voiceGroup"], note.pop("program"), note["key"])
        songs.append(song)
    check(songs[0]["loopStart"] == 0 and songs[1]["loopStart"] is None, "Prototype loop policy changed")
    payload = {"schemaVersion": 1, "music": songs[0], "soundEffect": songs[1], "voices": voices,
               "status": "bounded-prototype",
               "limitations": ["Web Audio sample resampling, continuous envelope ramps and stereo pan approximate the GBA mixer.",
                               "PSG duty and pitch/sweep are reconstructed; hardware quantization, channel stealing and exact envelope clocks are not emulated.",
                               "Source reverb is recorded but not rendered; music stops and restarts on map/focus changes without source fades.",
                               "Only MUS_PALLET and SE_SELECT and their required source commands/voices are exported."]}
    put("client/audio/preview.json", payload)
    return {"url": "/content/audio/preview.json", "music": "MUS_PALLET", "soundEffect": "SE_SELECT", "status": "bounded-prototype"}
