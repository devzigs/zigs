import * as T from './vendor/three.js';
import { radiusAt, emberDirection } from './identity.js';
export const RASTER_SIZE = 192;
export function createStudio({ size = RASTER_SIZE } = {}) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2', { alpha: true, antialias: true, preserveDrawingBuffer: true,
    powerPreference: 'low-power', failIfMajorPerformanceCaveat: true });
  if (!context) throw new Error('WebGL2 unavailable');
  const renderer = new T.WebGLRenderer({ canvas, context, alpha: true, antialias: true });
  renderer.setPixelRatio(1); renderer.setSize(size, size, false);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
  renderer.setClearColor(0x000000, 0);
  let lost = false;
  canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); lost = true; });
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(32, 1, .1, 30);
  camera.position.set(0, .12, 4.85); camera.lookAt(0, 0, 0);
  const room = new T.Scene(); room.background = new T.Color(0x151b24);
  const panels = [];
  function softbox(w, h, position, color, intensity) {
    const material = new T.MeshBasicMaterial({ color: new T.Color(color).multiplyScalar(intensity), side: T.DoubleSide });
    const panel = new T.Mesh(new T.PlaneGeometry(w, h), material);
    panel.position.set(...position); panel.lookAt(0, 0, 0); room.add(panel); panels.push(panel);
  }
  softbox(4, 6, [-3, 3, 3], '#ffffff', 5);
  softbox(1.3, 5, [3, .5, 2], '#dce9ff', 3.5);
  softbox(5, 2, [0, 4, -1], '#ffffff', 4);
  softbox(3, 1.2, [0, -2.5, 3], '#eb8e51', 1.6);
  softbox(2, 3, [-3, 0, -2], '#91a7bd', 2);
  const pmrem = new T.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(room, .04, .1, 30); scene.environment = environment.texture;
  panels.forEach((p) => { p.geometry.dispose(); p.material.dispose(); }); pmrem.dispose();
  scene.add(new T.AmbientLight(0xffffff, .35));
  const key = new T.DirectionalLight(0xffffff, 2); key.position.set(-3, 4, 5); scene.add(key);
  let group, sculpture, resources = [];
  function clear() {
    if (group) scene.remove(group);
    resources.forEach((r) => r.dispose()); resources = []; group = null;
    renderer.renderLists.dispose();
  }
  function setSculpture(p) {
    clear(); sculpture = p;
    if (lost) throw new Error('WebGL context lost');
    group = new T.Group();
    const geometry = p.family === 0 ? new T.IcosahedronGeometry(1, p.facetDetail) : new T.SphereGeometry(1, 96, 64);
    const positions = geometry.attributes.position, colors = [];
    const base = new T.Color(['#bac1c8', '#626d7b', '#d5d8dc'][p.finish]);
    const accent = new T.Color(p.accent), dark = new T.Color('#27313f');
    for (let i = 0; i < positions.count; i++) {
      const v = new T.Vector3().fromBufferAttribute(positions, i).normalize(), r = radiusAt(p, v.x, v.y, v.z);
      positions.setXYZ(i, v.x * r, v.y * r * p.squash, v.z * r);
      const stripe = Math.sin(v.y * (p.rings + 1) * 5 + Math.atan2(v.z, v.x) * p.twist + p.phase);
      const color = base.clone();
      if (stripe > .95) color.lerp(dark, .7);
      if (stripe < -.97) color.lerp(accent, .68);
      colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3)); geometry.computeVertexNormals();
    const material = new T.MeshStandardMaterial({ vertexColors: true, metalness: 1,
      roughness: p.roughness + (p.family === 2 ? .08 : 0), flatShading: p.family === 0,
      envMapIntensity: p.finish === 1 ? .85 : 1.15 });
    const body = new T.Mesh(geometry, material);
    group.add(body);
    resources = [geometry, material];
    if (p.traits.rare) {
      const inlayMaterial = new T.MeshStandardMaterial({ color: '#ed9554', metalness: .85,
        roughness: .24, emissive: '#7d300b', emissiveIntensity: .22 });
      resources.push(inlayMaterial);
      // Flat facets need intersection with the actual mesh. Smooth families share radiusAt.
      const ray = p.family === 0 ? new T.Raycaster() : null;
      body.updateMatrixWorld(true);
      for (const band of [-1, 1]) {
        const positions = [], indices = [], steps = 144;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps * Math.PI * 2;
          const center = new T.Vector3(...emberDirection(p, t, band));
          const tangent = new T.Vector3(...emberDirection(p, t + .001, band))
            .sub(new T.Vector3(...emberDirection(p, t - .001, band))).normalize();
          const across = center.clone().cross(tangent).normalize();
          for (const side of [-1, 1]) {
            const direction = center.clone().addScaledVector(across, side * .014).normalize();
            let point;
            if (ray) {
              ray.set(direction.clone().multiplyScalar(3), direction.clone().negate());
              point = ray.intersectObject(body, false)[0]?.point;
            } else {
              point = direction.clone().multiplyScalar(radiusAt(p, direction.x, direction.y, direction.z));
              point.y *= p.squash;
            }
            point ??= direction.clone();
            point.addScaledVector(direction, .007);
            positions.push(point.x, point.y, point.z);
          }
          if (i < steps) { const k = i * 2; indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
        }
        const inlay = new T.BufferGeometry();
        inlay.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
        inlay.setIndex(indices); inlay.computeVertexNormals();
        group.add(new T.Mesh(inlay, inlayMaterial)); resources.push(inlay);
      }
    }
    if (p.family === 4) for (let i = 0; i < p.rings; i++) {
      const y = (i - (p.rings - 1) / 2) * .4;
      const ringGeo = new T.TorusGeometry(Math.sqrt(1 - y * y) + .015, .025, 8, 96);
      const ringMat = new T.MeshStandardMaterial({ color: i === 0 ? p.accent : '#c6cdd4', metalness: 1, roughness: .2 });
      const ring = new T.Mesh(ringGeo, ringMat); ring.rotation.x = Math.PI / 2; ring.position.y = y;
      group.add(ring); resources.push(ringGeo, ringMat);
    }
    group.rotation.set(p.tilt, p.rotation, p.tilt * .6); scene.add(group);
  }
  // The camera, environment and key light stay fixed while the actual mesh turns.
  function draw(rotation = 0, tilt = 0) {
    if (lost || !group) throw new Error('WebGL sculpture unavailable');
    group.rotation.set(sculpture.tilt + tilt, sculpture.rotation + rotation, sculpture.tilt * .6);
    renderer.render(scene, camera);
    if (lost || context.isContextLost()) throw new Error('WebGL context lost');
  }
  function render(p) {
    try {
      setSculpture(p); draw();
      return canvas.toDataURL('image/png');
    } finally { clear(); }
  }
  return { canvas, render, setSculpture, draw, dispose() {
    clear(); environment.dispose(); renderer.dispose(); renderer.forceContextLoss();
  } };
}
