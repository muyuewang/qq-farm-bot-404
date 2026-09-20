"""Reproduce the official Cocos jinghui default clip at its authored 60 Hz.

Offline inputs: effect_images/mutant/jinghui (original CCON, binary and prefab).
Only the curve modes present in that clip are supported; fail on new modes.
"""
import json
import math
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'core/src/gameConfig/effect_images/mutant/jinghui'


def read_curve(ref, binary):
    offset = ref['offset']
    count = struct.unpack_from('<I', binary, offset + 2)[0]
    times = struct.unpack_from('<' + 'f' * count, binary, offset + 6)
    offset += 6 + count * 4
    values = []
    for time in times:
        flags, value = struct.unpack_from('<If', binary, offset)
        offset += 8
        key = dict(time=time, value=value, mode=0, weight=0, lt=0, lw=0, rt=0, rw=0)
        assert flags >> 8 == 0, 'Unsupported easing'
        for bit, fmt, name in [(2, 'B', 'mode'), (4, 'B', 'weight'), (8, 'f', 'lt'),
                               (16, 'f', 'lw'), (32, 'f', 'rt'), (64, 'f', 'rw')]:
            if flags & bit:
                key[name] = struct.unpack_from('<' + fmt, binary, offset)[0]
                offset += struct.calcsize(fmt)
        assert key['mode'] in (0, 1, 2)
        values.append(key)
    assert offset == ref['offset'] + ref['length']
    return values


def bezier(a, b, c, d, t):
    return (1-t)**3*a + 3*(1-t)**2*t*b + 3*(1-t)*t*t*c + t**3*d


def evaluate(keys, time):
    if time <= keys[0]['time']:
        return keys[0]['value']
    if time >= keys[-1]['time']:
        return keys[-1]['value']
    right = next(i for i, key in enumerate(keys) if key['time'] > time)
    a, b = keys[right-1:right+1]
    dt = b['time'] - a['time']
    t = (time - a['time']) / dt
    if a['mode'] == 1:
        return a['value']
    if a['mode'] == 0:
        return a['value'] + (b['value'] - a['value']) * t
    rw = a['rw'] if a['weight'] & 2 else math.hypot(dt, dt*a['rt']) / 3
    lw = b['lw'] if b['weight'] & 1 else math.hypot(dt, dt*b['lt']) / 3
    x1 = math.cos(math.atan(a['rt'])) * rw / dt
    x2 = 1 - math.cos(math.atan(b['lt'])) * lw / dt
    y1 = a['value'] + math.sin(math.atan(a['rt'])) * rw
    y2 = b['value'] - math.sin(math.atan(b['lt'])) * lw
    # Cocos chooses the largest real root in [0, 1], including crossed handles.
    qa, qb, qc = 3*(1+3*x1-3*x2), 6*(x2-2*x1), 3*x1
    critical = []
    if abs(qa) < 1e-12:
        if abs(qb) > 1e-12:
            critical = [-qc/qb]
    elif qb*qb-4*qa*qc >= 0:
        disc = math.sqrt(qb*qb-4*qa*qc)
        critical = [(-qb-disc)/(2*qa), (-qb+disc)/(2*qa)]
    boundaries = [0.] + sorted(v for v in critical if 0 < v < 1) + [1.]
    roots = []
    for lo, hi in zip(boundaries, boundaries[1:]):
        f = lambda u: bezier(0, x1, x2, 1, u) - t
        if f(lo)*f(hi) > 0:
            continue
        for _ in range(45):
            mid = (lo + hi) / 2
            if f(lo)*f(mid) <= 0:
                hi = mid
            else:
                lo = mid
        roots.append((lo + hi) / 2)
    assert roots
    return bezier(a['value'], y1, y2, b['value'], max(roots))


def generate():
    document = json.loads((ASSETS / 'anim_loop_1.json').read_text())['document']
    binary = (ASSETS / 'anim_loop_1.bin').read_bytes()
    packed = json.loads((ASSETS / 'prefab-pack.json').read_text())
    nodes = packed[5][1][0]
    stars = [n for n in nodes if n[0] == 2]
    assert len(stars) == 9
    curves = {}
    for ref in document[0]['_tracks']:
        track = document[ref['__id__']]
        binding = document[track['_binding']['path']['__id__']]['_paths']
        name = document[binding[0]['__id__']]['path'].split('/')[-1]
        curves[name, binding[1]] = [read_curve(document[document[c['__id__']]['_curve']['__id__']]['bytes'], binary)
                                    for c in track['_channels'][:2]]
    duration = document[0]['_duration']
    frames = round(duration * document[0]['sample'])
    lines = ['/* Generated from official Cocos curves; run core/scripts/generate-crystal-animation.py. */']
    for index, star in enumerate(stars):
        lines.append(f'@keyframes official-crystal-{index} {{')
        for frame in range(frames + 1):
            time = frame / document[0]['sample']
            position, scale = star[-2][1:3], star[-1][1:3]
            for prop, target in [('position', position), ('scale', scale)]:
                if (star[1], prop) in curves:
                    target[:] = [evaluate(curve, time) for curve in curves[star[1], prop]]
            # Cocos has Y up; SVG has Y down. Parent star node has Y=-27.714.
            x, y = position
            sx, sy = scale
            lines.append(f'  {100*frame/frames:g}% {{ transform: translate({x:.4f}px, {27.714-y:.4f}px) scale({sx:.5f}, {sy:.5f}); }}')
        lines.append('}')
    return '\n'.join(lines) + '\n'


if __name__ == '__main__':
    target = ROOT / 'web/src/styles/official-crystal-animation.css'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(generate())
