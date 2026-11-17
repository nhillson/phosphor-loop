"""Makes tests/media/spin-cube.glb: a red cube spinning (an animation), on a grey slab, with a camera, as a Blender
glTF Binary export would have them. Used by tests/model_check.py."""
import json, math, os, struct

def cube(s):
    P, N, I = [], [], []
    for ax in range(3):
        for sg in (1, -1):
            n = [0, 0, 0]; n[ax] = sg
            u = [0, 0, 0]; u[(ax + 1) % 3] = 1
            v = [0, 0, 0]; v[(ax + 2) % 3] = 1
            b = len(P)
            for a, c in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                P.append([s * (n[i] + a * u[i] + c * v[i]) for i in range(3)]); N.append(n)
            I += [b, b + 1, b + 2, b, b + 2, b + 3] if sg > 0 else [b, b + 2, b + 1, b, b + 3, b + 2]
    return P, N, I

bins = bytearray(); views = []; accs = []
def add(data, fmt, comp, typ, count, target=None, mm=None):
    while len(bins) % 4: bins.append(0)
    off = len(bins); bins.extend(struct.pack('<' + fmt * (len(data)), *data))
    v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(bins) - off}
    if target: v['target'] = target
    views.append(v)
    a = {'bufferView': len(views) - 1, 'componentType': comp, 'count': count, 'type': typ}
    if mm: a['min'], a['max'] = mm
    accs.append(a); return len(accs) - 1

meshes = []
for s, col in ((1.0, [0.9, 0.1, 0.15, 1]), (None, [0.5, 0.5, 0.55, 1])):
    if s: P, N, I = cube(s)
    else:
        P, N, I = cube(1); P = [[p[0] * 3, p[1] * 0.1 - 1.6, p[2] * 3] for p in P]
    flat = [c for p in P for c in p]
    mn = [min(p[i] for p in P) for i in range(3)]; mx = [max(p[i] for p in P) for i in range(3)]
    pa = add(flat, 'f', 5126, 'VEC3', len(P), 34962, (mn, mx))
    na = add([c for n in N for c in n], 'f', 5126, 'VEC3', len(N), 34962)
    ia = add(I, 'H', 5123, 'SCALAR', len(I), 34963)
    meshes.append({'primitives': [{'attributes': {'POSITION': pa, 'NORMAL': na}, 'indices': ia, 'material': len(meshes)}]})
mats = [{'pbrMetallicRoughness': {'baseColorFactor': [0.9, 0.1, 0.15, 1], 'metallicFactor': 0.2, 'roughnessFactor': 0.4}},
        {'pbrMetallicRoughness': {'baseColorFactor': [0.5, 0.5, 0.55, 1], 'metallicFactor': 0.0, 'roughnessFactor': 0.8}}]
times = [i / 10 for i in range(41)]
rots = []
for t in times:
    a = t / 4 * math.pi * 2
    rots += [0, math.sin(a / 2), 0, math.cos(a / 2)]
ta = add(times, 'f', 5126, 'SCALAR', len(times), None, ([0], [4]))
ra = add(rots, 'f', 5126, 'VEC4', len(times))
cam_q = [-0.19509, 0, 0, 0.98079]   # looking down a little
gltf = {
    'asset': {'version': '2.0', 'generator': 'Phosphor Loop test'},
    'scene': 0, 'scenes': [{'nodes': [0, 1, 2]}],
    'nodes': [{'name': 'Cube', 'mesh': 0}, {'name': 'Slab', 'mesh': 1},
              {'name': 'Camera', 'camera': 0, 'translation': [0, 2.5, 7], 'rotation': cam_q}],
    'cameras': [{'type': 'perspective', 'perspective': {'yfov': 0.7, 'znear': 0.1, 'zfar': 100, 'aspectRatio': 1.78}}],
    'meshes': meshes, 'materials': mats,
    'animations': [{'name': 'Spin', 'samplers': [{'input': ta, 'output': ra, 'interpolation': 'LINEAR'}],
                    'channels': [{'sampler': 0, 'target': {'node': 0, 'path': 'rotation'}}]}],
    'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': 0}],
}
while len(bins) % 4: bins.append(0)
gltf['buffers'][0]['byteLength'] = len(bins)
js = json.dumps(gltf).encode()
while len(js) % 4: js += b' '
out = os.path.join(os.path.dirname(__file__), 'media', 'spin-cube.glb')
with open(out, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bins)))
    f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
    f.write(struct.pack('<II', len(bins), 0x004E4942)); f.write(bins)
print(out, os.path.getsize(out))
