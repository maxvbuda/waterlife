// Waterlife — a tiny WebGL viewer for the creature models in models/*.glb.
// Loads a binary glTF, merges its pieces by part, lights them, and lets the
// player drag to spin the creature. No libraries.

const ModelViewer = (() => {
  'use strict';

  const cache = new Map(); // url -> Promise<ArrayBuffer>

  function fetchModel(url) {
    if (!cache.has(url)) {
      const p = fetch(url).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      });
      p.catch(() => cache.delete(url));
      cache.set(url, p);
    }
    return cache.get(url);
  }

  // ---------------------------------------------------------------- glTF

  const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const ARRAYS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

  function parseGLB(buf) {
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('Not a .glb file');
    let off = 12, json = null, bin = null;
    while (off < buf.byteLength) {
      const len = dv.getUint32(off, true);
      const type = dv.getUint32(off + 4, true);
      if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 8, len)));
      else if (type === 0x004e4942) bin = buf.slice(off + 8, off + 8 + len);
      off += 8 + len;
    }
    return { json, bin };
  }

  function readAccessor(gltf, bin, index) {
    const acc = gltf.accessors[index];
    const view = gltf.bufferViews[acc.bufferView];
    const n = COMPONENTS[acc.type];
    const Arr = ARRAYS[acc.componentType];
    const start = (view.byteOffset || 0) + (acc.byteOffset || 0);
    const stride = view.byteStride || 0;
    const elem = n * Arr.BYTES_PER_ELEMENT;
    if (!stride || stride === elem) return new Arr(bin, start, acc.count * n);
    const out = new Arr(acc.count * n);
    const src = new DataView(bin);
    const get = { 1: 'getInt8', 2: Arr === Int16Array ? 'getInt16' : 'getUint16', 4: Arr === Float32Array ? 'getFloat32' : 'getUint32' }[Arr.BYTES_PER_ELEMENT];
    for (let i = 0; i < acc.count; i++) {
      for (let k = 0; k < n; k++) out[i * n + k] = src[get](start + i * stride + k * Arr.BYTES_PER_ELEMENT, true);
    }
    return out;
  }

  // Column-major 4x4 matrices.
  const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  function mul(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  }
  function nodeMatrix(node) {
    if (node.matrix) return node.matrix.slice();
    const [tx, ty, tz] = node.translation || [0, 0, 0];
    const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
    const [sx, sy, sz] = node.scale || [1, 1, 1];
    return [
      (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
      2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
      2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
      tx, ty, tz, 1,
    ];
  }

  // Flattens the scene into one merged mesh per (part name, material), baked into world space.
  function extractParts(gltf, bin) {
    const groups = new Map();
    const visit = (ni, parent, partName) => {
      const node = gltf.nodes[ni];
      const m = mul(parent, nodeMatrix(node));
      const name = node.name || partName;
      if (node.mesh != null) {
        const mesh = gltf.meshes[node.mesh];
        for (const prim of mesh.primitives) {
          if (prim.mode != null && prim.mode !== 4) continue;
          const pos = readAccessor(gltf, bin, prim.attributes.POSITION);
          const nor = prim.attributes.NORMAL != null ? readAccessor(gltf, bin, prim.attributes.NORMAL) : null;
          const idx = prim.indices != null ? readAccessor(gltf, bin, prim.indices) : null;
          const mat = gltf.materials && prim.material != null ? gltf.materials[prim.material] : null;
          const color = (mat && mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorFactor) || [0.8, 0.8, 0.8, 1];
          const key = `${mesh.name || name}|${prim.material}`;
          if (!groups.has(key)) groups.set(key, { name: mesh.name || name, color, pos: [], nor: [], idx: [], count: 0 });
          const g = groups.get(key);
          const base = g.count;
          const vc = pos.length / 3;
          for (let i = 0; i < vc; i++) {
            const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
            g.pos.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
            if (nor) {
              const a = nor[i * 3], b = nor[i * 3 + 1], c = nor[i * 3 + 2];
              let nx = m[0] * a + m[4] * b + m[8] * c, ny = m[1] * a + m[5] * b + m[9] * c, nz = m[2] * a + m[6] * b + m[10] * c;
              const l = Math.hypot(nx, ny, nz) || 1;
              g.nor.push(nx / l, ny / l, nz / l);
            } else {
              g.nor.push(0, 0, 0);
            }
          }
          if (idx) for (let i = 0; i < idx.length; i++) g.idx.push(base + idx[i]);
          else for (let i = 0; i < vc; i++) g.idx.push(base + i);
          if (!nor) faceNormals(g, base, vc);
          g.count += vc;
        }
      }
      for (const c of node.children || []) visit(c, m, name);
    };
    const scene = gltf.scenes[gltf.scene || 0];
    for (const ni of scene.nodes) visit(ni, ident(), '');
    return [...groups.values()];
  }

  function faceNormals(g, base, vc) {
    for (let i = 0; i < g.idx.length; i += 3) {
      const [a, b, c] = [g.idx[i], g.idx[i + 1], g.idx[i + 2]];
      if (a < base) continue;
      const p = (k) => [g.pos[k * 3], g.pos[k * 3 + 1], g.pos[k * 3 + 2]];
      const [A, B, C] = [p(a), p(b), p(c)];
      const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      for (const k of [a, b, c]) for (let j = 0; j < 3; j++) g.nor[k * 3 + j] += n[j];
    }
    for (let k = base; k < base + vc; k++) {
      const l = Math.hypot(g.nor[k * 3], g.nor[k * 3 + 1], g.nor[k * 3 + 2]) || 1;
      for (let j = 0; j < 3; j++) g.nor[k * 3 + j] /= l;
    }
  }

  // ---------------------------------------------------------------- rendering

  const VS = `
    attribute vec3 aPos;
    attribute vec3 aNor;
    uniform mat4 uView;
    uniform mat4 uProj;
    varying vec3 vN;
    varying vec3 vV;
    void main() {
      vec4 p = uView * vec4(aPos, 1.0);
      vV = -p.xyz;
      vN = (uView * vec4(aNor, 0.0)).xyz;
      gl_Position = uProj * p;
    }`;

  const FS = `
    precision mediump float;
    uniform vec3 uColor;
    uniform float uAlpha;
    uniform float uGlow;
    varying vec3 vN;
    varying vec3 vV;
    void main() {
      vec3 n = normalize(vN);
      if (!gl_FrontFacing) n = -n;
      vec3 v = normalize(vV);
      vec3 key = normalize(vec3(0.45, 0.8, 0.55));
      vec3 fill = normalize(vec3(-0.7, -0.15, 0.45));
      float hemi = 0.5 + 0.5 * n.y;
      vec3 ambient = mix(vec3(0.16, 0.2, 0.28), vec3(0.5, 0.58, 0.68), hemi);
      float d1 = max(dot(n, key), 0.0);
      float d2 = max(dot(n, fill), 0.0);
      float spec = pow(max(dot(n, normalize(key + v)), 0.0), 40.0) * 0.32;
      float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.4;
      vec3 c = uColor * (ambient + d1 * vec3(1.0, 0.96, 0.9) + d2 * vec3(0.45, 0.65, 1.0) * 0.3)
             + spec + rim * vec3(0.55, 0.78, 1.0);
      c = mix(c, uColor * 1.4 + 0.15, uGlow);
      c = pow(c, vec3(1.0 / 2.2));
      gl_FragColor = vec4(c * uAlpha, uAlpha);
    }`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }

  function orbitView(center, dist, yaw, pitch) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // view = T(0,0,-dist) * Rx(pitch) * Ry(yaw) * T(-center)
    const r = [cy, sp * sy, -cp * sy, 0, 0, cp, sp, 0, sy, -sp * cy, cp * cy, 0, 0, 0, 0, 1];
    const t = ident();
    t[12] = -center[0]; t[13] = -center[1]; t[14] = -center[2];
    const m = mul(r, t);
    m[14] -= dist;
    return m;
  }

  class Viewer {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.opts = opts;
      this.yaw = opts.yaw ?? -0.5;
      this.pitch = opts.pitch ?? 0.2;
      this.spin = opts.spin ?? 0.35;
      this.dragging = false;
      this.parts = [];
      const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true });
      if (!gl) throw new Error('WebGL not available');
      this.gl = gl;
      this.uint32 = !!gl.getExtension('OES_element_index_uint');
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      this.prog = prog;
      this.loc = {
        pos: gl.getAttribLocation(prog, 'aPos'), nor: gl.getAttribLocation(prog, 'aNor'),
        view: gl.getUniformLocation(prog, 'uView'), proj: gl.getUniformLocation(prog, 'uProj'),
        color: gl.getUniformLocation(prog, 'uColor'), alpha: gl.getUniformLocation(prog, 'uAlpha'),
        glow: gl.getUniformLocation(prog, 'uGlow'),
      };
      this.bindInput();
    }

    async load(url) {
      const { json, bin } = parseGLB(await fetchModel(url));
      const gl = this.gl;
      const style = this.opts.style || {};
      let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (const g of extractParts(json, bin)) {
        if (!g.idx.length) continue;
        for (let i = 0; i < g.pos.length; i += 3) {
          for (let k = 0; k < 3; k++) {
            if (g.pos[i + k] < min[k]) min[k] = g.pos[i + k];
            if (g.pos[i + k] > max[k]) max[k] = g.pos[i + k];
          }
        }
        const big = g.count > 65535;
        if (big && !this.uint32) continue;
        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        const inter = new Float32Array(g.count * 6);
        for (let i = 0; i < g.count; i++) {
          for (let k = 0; k < 3; k++) {
            inter[i * 6 + k] = g.pos[i * 3 + k];
            inter[i * 6 + 3 + k] = g.nor[i * 3 + k];
          }
        }
        gl.bufferData(gl.ARRAY_BUFFER, inter, gl.STATIC_DRAW);
        const ibo = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, big ? new Uint32Array(g.idx) : new Uint16Array(g.idx), gl.STATIC_DRAW);
        const alpha = (style.alpha && style.alpha[g.name]) ?? 1;
        const glow = style.glow && style.glow.includes(g.name) ? 0.85 : 0;
        this.parts.push({ vbo, ibo, n: g.idx.length, type: big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, color: g.color.slice(0, 3), alpha, glow });
      }
      this.parts.sort((a, b) => (b.alpha === 1) - (a.alpha === 1));
      this.center = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
      this.radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 || 1;
      // the model spins around the vertical axis, so its on-screen width is at most its horizontal diagonal
      this.halfW = Math.hypot(max[0] - min[0], max[2] - min[2]) / 2 || 1;
      this.halfH = (max[1] - min[1]) / 2 || 1;
      this.start();
      return this;
    }

    bindInput() {
      const c = this.canvas;
      let lx = 0, ly = 0;
      c.addEventListener('pointerdown', (e) => {
        this.dragging = true;
        lx = e.clientX; ly = e.clientY;
        c.setPointerCapture(e.pointerId);
      });
      c.addEventListener('pointermove', (e) => {
        if (!this.dragging) return;
        this.yaw += (e.clientX - lx) * 0.01;
        this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch + (e.clientY - ly) * 0.01));
        lx = e.clientX; ly = e.clientY;
      });
      const up = () => { this.dragging = false; };
      c.addEventListener('pointerup', up);
      c.addEventListener('pointercancel', up);
    }

    start() {
      let last = performance.now();
      const frame = (now) => {
        if (!this.canvas.isConnected) { this.dispose(); return; }
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (!this.dragging) this.yaw += this.spin * dt;
        this.draw();
        this.raf = requestAnimationFrame(frame);
      };
      this.raf = requestAnimationFrame(frame);
    }

    draw() {
      const gl = this.gl, c = this.canvas;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.useProgram(this.prog);
      const aspect = w / Math.max(h, 1);
      const fov = 0.6;
      const t = Math.tan(fov / 2);
      const fit = Math.max(this.halfH / t, this.halfW / (t * aspect)) * 1.12 + this.halfW * 0.35;
      const dist = fit * (this.opts.zoom || 1);
      gl.uniformMatrix4fv(this.loc.proj, false, perspective(fov, aspect, dist * 0.05, dist + this.radius * 4));
      gl.uniformMatrix4fv(this.loc.view, false, orbitView(this.center, dist, this.yaw, this.pitch));
      gl.enableVertexAttribArray(this.loc.pos);
      gl.enableVertexAttribArray(this.loc.nor);
      for (const p of this.parts) {
        const transparent = p.alpha < 1;
        if (transparent) {
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.depthMask(false);
        } else {
          gl.disable(gl.BLEND);
          gl.depthMask(true);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, p.vbo);
        gl.vertexAttribPointer(this.loc.pos, 3, gl.FLOAT, false, 24, 0);
        gl.vertexAttribPointer(this.loc.nor, 3, gl.FLOAT, false, 24, 12);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, p.ibo);
        gl.uniform3fv(this.loc.color, p.color);
        gl.uniform1f(this.loc.alpha, p.alpha);
        gl.uniform1f(this.loc.glow, p.glow);
        gl.drawElements(gl.TRIANGLES, p.n, p.type, 0);
      }
      gl.depthMask(true);
    }

    dispose() {
      cancelAnimationFrame(this.raf);
      const gl = this.gl;
      for (const p of this.parts) { gl.deleteBuffer(p.vbo); gl.deleteBuffer(p.ibo); }
      this.parts = [];
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  }

  // Shows a spinning model in `canvas`. Resolves to the viewer, or rejects if WebGL or the file is unavailable
  // (for example when the page is opened straight from disk, where browsers block loading files).
  function show(canvas, id, style) {
    try {
      const v = new Viewer(canvas, { style, yaw: style && style.yaw, pitch: style && style.pitch, zoom: style && style.zoom });
      return v.load(`models/${id}.glb`).catch((e) => { v.dispose(); throw e; });
    } catch (e) {
      return Promise.reject(e);
    }
  }

  return { show, preload: (id) => fetchModel(`models/${id}.glb`).catch(() => {}) };
})();
