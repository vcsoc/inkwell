"""Generate Inkwell's short, gentle, royalty-free default arrival chime."""

import math
import struct
import wave
from pathlib import Path

RATE = 22050
DURATION = 0.72
OUTPUT = Path(__file__).resolve().parents[1] / "inkwell/static/new-mail.wav"


def note(t, start, frequency, length=0.35):
    elapsed = t - start
    if elapsed < 0 or elapsed >= length:
        return 0.0
    attack = min(1.0, elapsed / 0.015)
    release = min(1.0, (length - elapsed) / 0.16)
    envelope = attack * release * math.exp(-2.2 * elapsed)
    return envelope * (
        math.sin(2 * math.pi * frequency * elapsed)
        + 0.16 * math.sin(4 * math.pi * frequency * elapsed)
    )


samples = bytearray()
for frame in range(round(DURATION * RATE)):
    t = frame / RATE
    value = 0.14 * (note(t, 0.0, 587.33) + note(t, 0.19, 783.99))
    samples += struct.pack("<h", round(max(-1.0, min(1.0, value)) * 32767))
with wave.open(str(OUTPUT), "wb") as out:
    out.setnchannels(1)
    out.setsampwidth(2)
    out.setframerate(RATE)
    out.writeframes(samples)
