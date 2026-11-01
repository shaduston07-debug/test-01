// Exports the app's own creature and prop geometry for the Blender builds. Serve the repo with
// `python scripts/blender/serve.py <repo> <dump dir>`, open any page of it, and in the console:
//   const d = await import('/scripts/blender/dump.js'); await d.dumpAll();
const T = await import('../../vendor/three.bundle.js');
const M = await import('../../js/models3d.js');
const C = await import('../../js/creatures.js');
const WD = await import('../../js/world3d.js');
M.setThree(T); C.setThree(T); WD.setThree(T);

const post = (name, body) => fetch('/__dump?name=' + name, { method: 'POST', body });

// creatures: the sculpted, skinned mesh (always the sculpt, never a finished .glb) plus the joint spec
export async function dumpCreature(kind) {
  const S = await import('../../js/sculpt.js');
  const def = C.creatureDef(kind), root = new T.Group();
  const { joints, world } = M.makeJoints(def.spec, root);
  const boneNames = Object.keys(joints).filter((n) => n !== '_root');
  const g = await S.sculptGeometry({ key: 'dump|' + kind, parts: [{ tree: def.prims((n) => world[n].toArray()), h: def.h, skin: { falloff: 0.45, maxDist: def.h * 16, maxS: def.h * 4 } }], mats: null, boneNames });
  const P = g.attributes.position.array, I = g.index.array;
  await post(`cr-${kind}.bin`, new Blob([new Float32Array(P), new Uint32Array(I), new Uint16Array(g.attributes.skinIndex.array), new Float32Array(g.attributes.skinWeight.array)].map((a) => a.buffer)));
  await post(`cr-${kind}.json`, JSON.stringify({ kind, nv: P.length / 3, ni: I.length, bones: boneNames, spec: def.spec, color: def.color }));
}

// props: every mesh in world space, one part per material role
export async function dumpProp(name, root) {
  root.updateMatrixWorld(true);
  const parts = [], bufs = []; let off = 0;
  const push = (a) => { bufs.push(a.buffer); const o = off; off += a.byteLength; return [o, a.length, a.constructor.name]; };
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry, m = o.material;
    const P = g.attributes.position.clone().applyMatrix4(o.matrixWorld).array;
    const idx = g.index ? g.index.array : Uint32Array.from({ length: P.length / 3 }, (_, i) => i);
    parts.push({ mat: m.name || '', color: '#' + m.color.getHexString(), metal: m.metalness, rough: m.roughness, emissive: m.emissive ? '#' + m.emissive.getHexString() : null, emi: m.emissiveIntensity || 0,
      opacity: m.transparent ? m.opacity : 1, double: m.side === T.DoubleSide, pos: push(new Float32Array(P)),
      uv: g.attributes.uv ? push(new Float32Array(g.attributes.uv.array)) : null, col: g.attributes.color ? push(new Float32Array(g.attributes.color.array)) : null, idx: push(new Uint32Array(idx)) });
  });
  await post(`pr-${name}.bin`, new Blob(bufs));
  await post(`pr-${name}.json`, JSON.stringify({ name, parts }));
}

export async function dumpAll() {
  for (const k of C.CREATURES) await dumpCreature(k);
  await dumpProp('car', M.buildCar('sedan').root); await dumpProp('sports', M.buildCar('sports').root); await dumpProp('moto', M.buildMotorcycle().root);
  await dumpProp('castle', M.buildCastle().root); await dumpProp('street', M.buildCity('street').root); await dumpProp('district', M.buildCity('district').root);
  const S = await import('../../js/sculpt.js');
  for (const [k, def] of Object.entries(WD.WEAPONS)) {
    // the sculpted weapon, its parts named after their material
    const root = new T.Group(), list = def.parts();
    for (const [i, [mat, prims]] of list.entries()) {
      const geo = await S.sculptStatic({ key: 'dump|' + k + i, parts: [{ tree: S.union(prims), h: def.h }] });
      const m = mat(); m.name = mat.name || (m.emissiveIntensity > 1 ? 'glow' : 'plain');
      root.add(new T.Mesh(geo, m));
    }
    await dumpProp('w-' + k, root);
  }
}
