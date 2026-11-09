// Wall Lamp AR — bundled by esbuild (only the used parts of three.js end up in app.js)
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, HemisphereLight, DirectionalLight,
  MeshBasicMaterial, RingGeometry, CircleGeometry, PlaneGeometry, CanvasTexture,
  Vector3, Quaternion, Matrix4, MathUtils, SRGBColorSpace, AdditiveBlending, ACESFilmicToneMapping
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const MODEL_URL = 'WallLamp_web.glb';
const $ = id => document.getElementById(id);

/* ======================= renderer (one WebGL context for preview + AR) ======================= */
const previewBox = $('preview');
const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));   // 3x DPR on phones is wasted fill-rate
renderer.toneMapping = ACESFilmicToneMapping;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local');
renderer.xr.setFramebufferScaleFactor(0.85);                    // lighter AR framebuffer, still sharp with MSAA
previewBox.prepend(renderer.domElement);

// Cheap lighting instead of a PMREM environment (no extra render passes / shader compiles at startup)
function addLights(scene) {
  scene.add(new HemisphereLight(0xffffff, 0x8a7f70, 1.4));
  const key = new DirectionalLight(0xffffff, 1.6);
  key.position.set(0.6, 1, 1.2);
  scene.add(key);
}

/* ======================= model ======================= */
// Model facts: back plate at z = 0, front at z = +0.08 m, 6 x 60 cm, origin at the back-plate centre
// -> local +Z points out of the wall, +Y up.
let lampTemplate = null, diffuserMat = null;
const modelReady = fetch(MODEL_URL)
  .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
  .then(buf => new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej)))
  .then(gltf => {
    lampTemplate = gltf.scene;
    lampTemplate.traverse(o => { if (o.isMesh && o.material.name === 'Opal_Diffuser') diffuserMat = o.material; });
    return lampTemplate;
  });

/* ======================= preview (render on demand, no idle loop) ======================= */
const pScene = new Scene();
addLights(pScene);
const pCam = new PerspectiveCamera(32, 1, 0.05, 10);
pCam.position.set(0, 0, 1.45);
const pPivot = new Group();
pPivot.rotation.set(0.08, -0.6, 0);
pScene.add(pPivot);

let previewActive = true, renderQueued = false;
function renderPreview() {
  if (renderQueued || !previewActive) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; if (previewActive) renderer.render(pScene, pCam); });
}
function resizePreview() {
  const w = previewBox.clientWidth, h = previewBox.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  pCam.aspect = w / h;
  pCam.position.z = Math.max(1.0, 0.8 / Math.min(1, w / h * 1.1));   // keep the 60 cm lamp in frame
  pCam.updateProjectionMatrix();
  renderPreview();
}
new ResizeObserver(resizePreview).observe(previewBox);

let drag = null;
previewBox.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; previewBox.setPointerCapture(e.pointerId); });
previewBox.addEventListener('pointermove', e => {
  if (!drag) return;
  pPivot.rotation.y += (e.clientX - drag.x) * 0.01;
  pPivot.rotation.x = MathUtils.clamp(pPivot.rotation.x + (e.clientY - drag.y) * 0.005, -0.6, 0.6);
  drag.x = e.clientX; drag.y = e.clientY;
  renderPreview();
});
const endDrag = () => { drag = null; };
previewBox.addEventListener('pointerup', endDrag);
previewBox.addEventListener('pointercancel', endDrag);

/* ======================= AR scene ======================= */
const scene = new Scene();
addLights(scene);
const camera = new PerspectiveCamera(70, 1, 0.01, 30);   // replaced by the XR camera during the session

function radialTexture(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  stops.forEach(([o, col]) => grd.addColorStop(o, col));
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; return t;
}
const shadowMat = new MeshBasicMaterial({ transparent: true, depthWrite: false,
  map: radialTexture([[0, 'rgba(0,0,0,0.55)'], [0.55, 'rgba(0,0,0,0.25)'], [1, 'rgba(0,0,0,0)']]) });
const glowMat = new MeshBasicMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending,
  map: radialTexture([[0, 'rgba(255,190,120,0.55)'], [0.35, 'rgba(255,160,90,0.22)'], [1, 'rgba(255,140,60,0)']]) });
const shadowGeo = new PlaneGeometry(0.16, 0.74);
const glowGeo = new PlaneGeometry(0.9, 1.5);

// reticle: ring in the wall plane (local XY, normal +Z) + translucent "ghost" of the lamp
const reticle = new Group();
const ringMat = new MeshBasicMaterial({ color: 0x6be3a4, transparent: true, opacity: 0.9, depthTest: false });
const ring = new Mesh(new RingGeometry(0.07, 0.085, 40), ringMat);
const centerDot = new Mesh(new CircleGeometry(0.008, 12), ringMat);
ring.renderOrder = centerDot.renderOrder = 10;
const ghost = new Group();
reticle.add(ring, centerDot, ghost);
reticle.visible = false;
scene.add(reticle);

function makeLamp() {
  const root = new Group(), spin = new Group();
  root.add(spin);
  spin.add(lampTemplate.clone(true));                 // shares geometry + materials with the template
  const shadow = new Mesh(shadowGeo, shadowMat); shadow.position.z = 0.002;
  const glow = new Mesh(glowGeo, glowMat); glow.position.z = 0.003; glow.visible = lightOn;
  spin.add(shadow, glow);
  root.userData = { spin, glow };
  return root;
}

/* ======================= startup: model -> preview -> shader precompile ======================= */
let lightOn = true;
const enterBtn = $('enter'), supportEl = $('support');

const warmedUp = modelReady.then(async () => {
  const p = lampTemplate.clone(true);
  p.position.y = 0; p.position.z = -0.04;
  pPivot.add(p);
  resizePreview();

  const ghostMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
  const g = lampTemplate.clone(true);
  g.traverse(o => { if (o.isMesh) o.material = ghostMat; });
  ghost.add(g);

  // Compile every AR shader now (in parallel where KHR_parallel_shader_compile exists),
  // so the first AR frames don't stall on program linking.
  const warm = makeLamp();
  scene.add(warm); reticle.visible = true;
  try { await renderer.compileAsync(scene, camera); } catch { /* older drivers: compile lazily */ }
  scene.remove(warm); reticle.visible = false;
}).catch(err => {
  console.error(err);
  supportEl.textContent = 'Не удалось загрузить модель: ' + err.message;
  throw err;
});

/* ======================= support detection / iOS fallback ======================= */
let arSupported = false, mvEl = null;
const supportCheck = (async () => {
  try { arSupported = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch { }
  if (!arSupported) prepareModelViewer();
})();

// <model-viewer> (~950 KB) is loaded ONLY on devices without WebXR (iPhone -> AR Quick Look),
// in idle time, so the button click still counts as a user gesture for activateAR().
function prepareModelViewer() {
  const load = () => {
    const s = document.createElement('script');
    s.type = 'module';
    s.src = 'https://cdn.jsdelivr.net/npm/@google/model-viewer@4.0.0/dist/model-viewer.min.js';
    document.head.appendChild(s);
    mvEl = document.createElement('model-viewer');
    mvEl.setAttribute('src', new URL(MODEL_URL, location.href).href);
    mvEl.setAttribute('ar', '');
    mvEl.setAttribute('ar-modes', 'quick-look scene-viewer');
    mvEl.setAttribute('ar-placement', 'wall');
    mvEl.setAttribute('loading', 'eager');
    mvEl.style.cssText = 'position:fixed;width:1px;height:1px;left:-10px;top:-10px;opacity:0;pointer-events:none';
    const hiddenBtn = document.createElement('button'); hiddenBtn.slot = 'ar-button'; hiddenBtn.style.display = 'none';
    mvEl.appendChild(hiddenBtn);
    document.body.appendChild(mvEl);
  };
  (window.requestIdleCallback || (cb => setTimeout(cb, 300)))(load);
}

Promise.allSettled([warmedUp, supportCheck]).then(([w]) => {
  if (w.status === 'rejected') return;
  enterBtn.disabled = false;
  if (arSupported) {
    enterBtn.textContent = 'Повесить на стену (AR)';
    supportEl.textContent = 'WebXR AR доступен ✓';
  } else {
    enterBtn.textContent = 'Открыть в AR';
    supportEl.textContent = window.isSecureContext
      ? 'WebXR не поддерживается — откроется системный AR-просмотрщик (iPhone: Quick Look).'
      : 'Нужен HTTPS: откройте страницу по защищённой ссылке.';
  }
});

enterBtn.onclick = async () => {
  if (arSupported) return startAR();
  if (mvEl && mvEl.canActivateAR) mvEl.activateAR();
  else supportEl.textContent = 'AR на этом устройстве недоступен. Нужен Android (Chrome + ARCore) или iPhone (Safari).';
};

/* ======================= AR UI ======================= */
const overlay = $('overlay'), startEl = $('start'), statusText = $('statusText'), dot = $('dot');
const bUndo = $('bUndo'), bMove = $('bMove'), bLight = $('bLight'), bExit = $('bExit');
const lamps = [];
let active = null, moving = false;

let lastStatus = '';
function status(text, state = '') {
  const key = text + state;
  if (key === lastStatus) return;          // avoid DOM writes every frame
  lastStatus = key;
  statusText.textContent = text;
  dot.className = state;
}
function refreshButtons() {
  bUndo.disabled = lamps.length === 0;
  bMove.disabled = !active;
  bMove.classList.toggle('on', moving);
}
function setLight(on) {
  lightOn = on;
  if (diffuserMat) diffuserMat.emissiveIntensity = on ? 1 : 0;
  for (const l of lamps) l.userData.glow.visible = on;
  bLight.classList.toggle('on', on);
}
[bUndo, bMove, bLight, bExit, $('status')].forEach(el =>
  el.addEventListener('beforexrselect', e => e.preventDefault()));   // UI taps must not place a lamp

bUndo.onclick = () => {
  const l = lamps.pop(); if (l) scene.remove(l);
  active = lamps[lamps.length - 1] || null; moving = false; refreshButtons();
};
bMove.onclick = () => { if (active) { moving = !moving; active.visible = !moving; refreshButtons(); } };
bLight.onclick = () => setLight(!lightOn);
bExit.onclick = () => xrSession && xrSession.end();

/* ======================= WebXR session ======================= */
let xrSession = null, hitSource = null, haveWall = false;
const wallPos = new Vector3(), wallQuat = new Quaternion();
let gesture = null, lastGestureEnd = 0;

async function startAR() {
  enterBtn.disabled = true;
  try {
    xrSession = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],          // no plane-detection: hit-test already uses ARCore planes
      domOverlay: { root: overlay }
    });
  } catch (e) {
    supportEl.textContent = 'Не удалось запустить AR: ' + e.message;
    enterBtn.disabled = false; return;
  }
  previewActive = false;
  overlay.style.display = 'block';
  startEl.style.display = 'none';
  await renderer.xr.setSession(xrSession);

  const viewerSpace = await xrSession.requestReferenceSpace('viewer');
  try { hitSource = await xrSession.requestHitTestSource({ space: viewerSpace, entityTypes: ['plane'] }); }
  catch { hitSource = await xrSession.requestHitTestSource({ space: viewerSpace }); }

  xrSession.addEventListener('select', onSelect);
  xrSession.addEventListener('end', onEnd);
  status('Медленно поводите телефоном по стене…');
  setLight(lightOn); refreshButtons();
  renderer.setAnimationLoop(onFrame);
}

function onEnd() {
  renderer.setAnimationLoop(null);
  hitSource && hitSource.cancel(); hitSource = null; xrSession = null;
  for (const l of lamps.splice(0)) scene.remove(l);
  active = null; moving = false; haveWall = false; reticle.visible = false; lastStatus = '';
  overlay.style.display = 'none';
  startEl.style.display = 'flex';
  enterBtn.disabled = false;
  previewActive = true; resizePreview();
}

function onSelect() {
  if (gesture || performance.now() - lastGestureEnd < 450) return;   // end of a pinch, not a tap
  if (!haveWall) { status('Нужна стена — наведите прицел на вертикальную поверхность', 'bad'); return; }
  if (moving && active) {
    active.position.copy(wallPos); active.quaternion.copy(wallQuat);
    active.visible = true; moving = false;
  } else {
    const lamp = makeLamp();
    lamp.position.copy(wallPos); lamp.quaternion.copy(wallQuat);
    scene.add(lamp); lamps.push(lamp); active = lamp;
  }
  refreshButtons();
}

/* two-finger twist (rotate around the wall normal) + pinch (scale) on the active lamp */
const touchInfo = t => {
  const dx = t[1].clientX - t[0].clientX, dy = t[1].clientY - t[0].clientY;
  return { d: Math.hypot(dx, dy), a: Math.atan2(dy, dx) };
};
overlay.addEventListener('touchstart', e => {
  if (e.touches.length === 2 && active) {
    const { d, a } = touchInfo(e.touches), s = active.userData.spin;
    gesture = { d0: d, a0: a, s0: s.scale.x, r0: s.rotation.z };
  }
}, { passive: true });
overlay.addEventListener('touchmove', e => {
  if (!gesture || e.touches.length !== 2 || !active) return;
  const { d, a } = touchInfo(e.touches), s = active.userData.spin;
  s.scale.setScalar(MathUtils.clamp(gesture.s0 * d / gesture.d0, 0.4, 3));
  s.rotation.z = gesture.r0 - (a - gesture.a0);
}, { passive: true });
overlay.addEventListener('touchend', e => {
  if (gesture && e.touches.length < 2) { gesture = null; lastGestureEnd = performance.now(); }
}, { passive: true });

/* ======================= per-frame wall tracking (allocation-free) ======================= */
const WALL_MAX_NY = 0.35;                 // |normal.y| below this => vertical surface
const UP = new Vector3(0, 1, 0), Z_AXIS = new Vector3(0, 0, 1);
const _m = new Matrix4(), _basis = new Matrix4();
const _p = new Vector3(), _n = new Vector3(), _v = new Vector3();
const _x = new Vector3(), _y = new Vector3();
const _q = new Quaternion();

// +Z = wall normal, +Y = world-up projected onto the wall -> lamp always hangs plumb
function wallQuaternion(n, out) {
  _y.copy(UP).addScaledVector(n, -UP.dot(n)).normalize();
  _x.crossVectors(_y, n);
  return out.setFromRotationMatrix(_basis.makeBasis(_x, _y, n));
}

function onFrame(time, frame) {
  if (frame && hitSource) {
    const ref = renderer.xr.getReferenceSpace();
    const results = frame.getHitTestResults(hitSource);
    let found = false, other = null;

    for (let i = 0; i < results.length; i++) {
      const pose = results[i].getPose(ref);
      if (!pose) continue;
      _m.fromArray(pose.transform.matrix);
      _n.setFromMatrixColumn(_m, 1).normalize();          // hit pose +Y = surface normal
      if (Math.abs(_n.y) < WALL_MAX_NY) {
        _p.setFromMatrixPosition(_m);
        const viewer = frame.getViewerPose(ref);
        if (viewer) {                                      // normal must face the user
          const vp = viewer.transform.position;
          if (_v.set(vp.x, vp.y, vp.z).sub(_p).dot(_n) < 0) _n.negate();
        }
        wallQuaternion(_n, _q);
        found = true;
        break;
      }
      if (!other) other = pose;
    }

    if (found) {
      if (!haveWall || !reticle.visible) { reticle.position.copy(_p); reticle.quaternion.copy(_q); }
      reticle.position.lerp(_p, 0.35);                    // smoothing hides tracking jitter
      reticle.quaternion.slerp(_q, 0.35);
      reticle.visible = ghost.visible = true;
      ringMat.color.setHex(0x6be3a4);
      wallPos.copy(reticle.position); wallQuat.copy(reticle.quaternion);
      haveWall = true;
      status(moving ? 'Коснитесь — переместить сюда' : 'Стена найдена — коснитесь, чтобы повесить', 'ok');
    } else {
      haveWall = false; ghost.visible = false;
      if (other) {                                         // floor / table: red reticle
        _m.fromArray(other.transform.matrix);
        reticle.position.setFromMatrixPosition(_m);
        reticle.quaternion.setFromUnitVectors(Z_AXIS, _n.setFromMatrixColumn(_m, 1).normalize());
        reticle.visible = true; ringMat.color.setHex(0xff6b6b);
        status('Это не стена — наведите на вертикальную поверхность', 'bad');
      } else {
        reticle.visible = false;
        status('Ищем стену… поводите телефоном');
      }
    }
  }
  renderer.render(scene, camera);
}
