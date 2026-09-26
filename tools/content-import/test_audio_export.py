"""Independent canonical MIDI fixtures for the bounded MPlay sequence reader."""
import json
from pathlib import Path
import struct
import unittest

from audio_export import AudioError, sequence, wav_metadata
from import_content import ROOT, Source


def midi_tracks(data: bytes) -> dict:
    """Read MIDI notes directly, without reusing assembly parser constants/state."""
    assert data[:4] == b"MThd" and struct.unpack_from(">I", data, 4)[0] == 6
    midi_format, count, division = struct.unpack_from(">HHH", data, 8)
    assert midi_format == 1 and division == 24
    position = 14

    def variable() -> int:
        nonlocal position
        result = 0
        for _ in range(4):
            value = data[position]
            position += 1
            result = result * 128 + (value & 127)
            if value < 128:
                return result
        raise AssertionError("Invalid MIDI variable length integer")

    tracks, tempos = [], []
    for _ in range(count):
        assert data[position:position + 4] == b"MTrk"
        end = position + 8 + struct.unpack_from(">I", data, position + 4)[0]
        position += 8
        tick, running = 0, None
        notes, active = [], {}
        while position < end:
            tick += variable()
            status = data[position]
            if status >= 128:
                position += 1
                if status < 240:
                    running = status
            else:
                assert running is not None
                status = running
            if status == 255:
                kind = data[position]
                position += 1
                length = variable()
                payload = data[position:position + length]
                position += length
                if kind == 81:
                    tempos.append((tick, int.from_bytes(payload, "big")))
            elif status in (240, 247):
                size = variable()
                position += size
            else:
                kind, channel = status & 240, status & 15
                length = 1 if kind in (192, 208) else 2
                values = data[position:position + length]
                position += length
                if kind == 144 and values[1] > 0:
                    identity = channel, values[0]
                    assert identity not in active
                    active[identity] = {"tick": tick, "key": values[0], "velocity": values[1]}
                    notes.append(active[identity])
                elif kind == 128 or kind == 144 and values[1] == 0:
                    note = active.pop((channel, values[0]))
                    note["ticks"] = tick - note["tick"]
        assert position == end and not active
        tracks.append({"endTick": tick, "notes": notes})
    assert position == len(data)
    return {"ticksPerQuarter": division, "tempos": tempos, "tracks": tracks}


class PinnedAudioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        lock = json.loads((ROOT / "source-lock.json").read_text(encoding="utf-8-sig"))
        manifest = json.loads((ROOT / lock["fingerprint"]["manifest"]).read_text(encoding="utf-8-sig"))
        cls.source = Source(Path(lock["reference"]["localPath"]), {row["path"]: row for row in manifest["records"]})

    def test_pallet_every_note_and_gate_matches_independent_midi(self):
        self.assert_song("mus_pallet", 88, 681818, 1536, [115, 78, 115, 68, 66, 78], True)

    def test_select_every_note_and_gate_matches_independent_midi(self):
        self.assert_song("se_select", 300, 200000, 18, [5], False)

    def assert_song(self, name, bpm, microseconds, end_tick, counts, loops):
        source = self.source
        song = sequence(source.text(f"sound/songs/midi/{name}.s"), name)
        midi = midi_tracks(source.read(f"sound/songs/midi/{name}.mid"))
        self.assertEqual(midi["tempos"], [(0, microseconds)])
        self.assertEqual(song["tempo"], bpm)
        self.assertEqual(song["ticksPerBeat"], midi["ticksPerQuarter"])
        playing = [track for track in midi["tracks"] if track["notes"]]
        self.assertEqual([len(track["notes"]) for track in playing], counts)
        self.assertEqual(len(song["tracks"]), len(playing))
        seconds = 60 / (bpm * 24)
        self.assertAlmostEqual(song["duration"], end_tick * seconds)
        self.assertEqual(song["loopStart"], 0 if loops else None)
        self.assertEqual(song["loopEnd"], end_tick * seconds if loops else None)
        for original, converted in zip(playing, song["tracks"]):
            self.assertEqual(original["endTick"], end_tick)
            self.assertEqual(len(original["notes"]), len(converted["notes"]))
            for expected, actual in zip(original["notes"], converted["notes"]):
                self.assertEqual((actual["key"], actual["velocity"]), (expected["key"], expected["velocity"]))
                self.assertAlmostEqual(actual["time"], expected["tick"] * seconds)
                self.assertAlmostEqual(actual["duration"], expected["ticks"] * seconds)

    def test_unknown_commands_tempo_changes_and_broken_waves_fail(self):
        source = self.source.text("sound/songs/midi/se_select.s")
        for unknown in ("PATT", "W999", "N999"):
            with self.assertRaises(AudioError, msg=f"Expected explicit rejection of {unknown}"):
                sequence(source.replace("W03", unknown, 1), "se_select")
        with self.assertRaisesRegex(AudioError, "fixed initial tempo"):
            sequence(source.replace(".byte\tW03", ".byte\tW03\n\t.byte TEMPO, 100", 1), "se_select")
        sample = self.source.read("sound/direct_sound_samples/sc88pro_nylon_str_guitar.wav")
        with self.assertRaisesRegex(AudioError, "Truncated WAVE"):
            wav_metadata(sample[:-1])


if __name__ == "__main__":
    unittest.main(verbosity=2)
