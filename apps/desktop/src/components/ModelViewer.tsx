import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { RwModel, RwTexture } from "../lib/rw";

/**
 * Просмотр 3D-модели без сторонних библиотек (WebGL 2).
 * Перетаскивание мышью — поворот, колесо — приближение, двойной щелчок — сброс.
 */

const VERTEX = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;
in vec2 aUv;
uniform mat4 uViewProjection;
out vec3 vNormal;
out vec2 vUv;
void main() {
  vNormal = aNormal;
  vUv = aUv;
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in vec3 vNormal;
in vec2 vUv;
uniform sampler2D uTexture;
uniform bool uTextured;
uniform vec4 uColor;
uniform vec3 uLight;
uniform vec3 uFill;
out vec4 outColor;
void main() {
  vec4 base = uColor;
  if (uTextured) base *= texture(uTexture, vUv);
  if (base.a < 0.4) discard;
  vec3 n = normalize(vNormal);
  // Двусторонний свет: у моделей SA часть граней смотрит внутрь.
  float key = abs(dot(n, uLight));
  float fill = abs(dot(n, uFill));
  float light = 0.42 + 0.5 * key + 0.18 * fill;
  outColor = vec4(base.rgb * light, 1.0);
}`;

type Mat4 = Float32Array;

function perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

function lookAt(eye: number[], target: number[], up: number[]): Mat4 {
  const z = normalize([eye[0]! - target[0]!, eye[1]! - target[1]!, eye[2]! - target[2]!]);
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  const m = new Float32Array(16);
  m.set([x[0]!, y[0]!, z[0]!, 0, x[1]!, y[1]!, z[1]!, 0, x[2]!, y[2]!, z[2]!, 0]);
  m[12] = -(x[0]! * eye[0]! + x[1]! * eye[1]! + x[2]! * eye[2]!);
  m[13] = -(y[0]! * eye[0]! + y[1]! * eye[1]! + y[2]! * eye[2]!);
  m[14] = -(z[0]! * eye[0]! + z[1]! * eye[1]! + z[2]! * eye[2]!);
  m[15] = 1;
  return m;
}

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      let s = 0;
      for (let k = 0; k < 4; k += 1) s += a[k * 4 + r]! * b[c * 4 + k]!;
      out[c * 4 + r] = s;
    }
  }
  return out;
}

const cross = (a: number[], b: number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const normalize = (a: number[]) => {
  const l = Math.hypot(a[0]!, a[1]!, a[2]!) || 1;
  return [a[0]! / l, a[1]! / l, a[2]! / l];
};

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
  return shader;
}

interface View {
  yaw: number;
  pitch: number;
  distance: number;
}

export function ModelViewer({ model, textures, label, height = 440 }: { model: RwModel; textures: Map<string, RwTexture>; label: string; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>({ yaw: 0, pitch: 0.08, distance: 1 });
  const drawRef = useRef<() => void>(() => undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: true, preserveDrawingBuffer: false });
    if (!gl) {
      setError("Видеокарта или система не поддерживает WebGL 2 — 3D-просмотр недоступен.");
      return;
    }
    let program: WebGLProgram;
    try {
      program = gl.createProgram()!;
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link");
    } catch {
      setError("Не удалось подготовить 3D-просмотр.");
      return;
    }
    const loc = {
      position: gl.getAttribLocation(program, "aPosition"),
      normal: gl.getAttribLocation(program, "aNormal"),
      uv: gl.getAttribLocation(program, "aUv"),
      viewProjection: gl.getUniformLocation(program, "uViewProjection"),
      texture: gl.getUniformLocation(program, "uTexture"),
      textured: gl.getUniformLocation(program, "uTextured"),
      color: gl.getUniformLocation(program, "uColor"),
      light: gl.getUniformLocation(program, "uLight"),
      fill: gl.getUniformLocation(program, "uFill"),
    };

    const buffers: WebGLBuffer[] = [];
    const glTextures = new Map<string, WebGLTexture>();
    const upload = (data: ArrayBufferView, target: number = gl.ARRAY_BUFFER) => {
      const b = gl.createBuffer()!;
      gl.bindBuffer(target, b);
      gl.bufferData(target, data, gl.STATIC_DRAW);
      buffers.push(b);
      return b;
    };
    const textureFor = (name: string | null): WebGLTexture | null => {
      if (!name) return null;
      const cached = glTextures.get(name);
      if (cached) return cached;
      const t = textures.get(name);
      if (!t) return null;
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, t.width, t.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, t.rgba);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      glTextures.set(name, tex);
      return tex;
    };

    const vao = gl.createVertexArray();
    const meshes = model.meshes.map((mesh) => {
      const position = upload(mesh.positions);
      const normal = upload(mesh.normals);
      const uv = mesh.uvs ? upload(mesh.uvs) : null;
      const parts = mesh.parts.map((p) => ({
        index: upload(p.indices, gl.ELEMENT_ARRAY_BUFFER),
        count: p.indices.length,
        texture: textureFor(p.material.texture),
        color: p.material.color.map((c) => c / 255),
      }));
      return { position, normal, uv, parts };
    });

    const { min, max } = model.bounds;
    const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const radius = Math.max(0.5, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.useProgram(program);
      gl.bindVertexArray(vao);

      const v = viewRef.current;
      const dist = radius * 2.9 * v.distance;
      // Лицо модели смотрит на +Y: камера по умолчанию спереди.
      const eye = [
        center[0]! + dist * Math.cos(v.pitch) * Math.sin(v.yaw),
        center[1]! + dist * Math.cos(v.pitch) * Math.cos(v.yaw),
        center[2]! + dist * Math.sin(v.pitch),
      ];
      const vp = multiply(perspective(0.6, w / h, radius * 0.05, radius * 20), lookAt(eye, center, [0, 0, 1]));
      gl.uniformMatrix4fv(loc.viewProjection, false, vp);
      const toEye = normalize([eye[0]! - center[0]!, eye[1]! - center[1]!, eye[2]! - center[2]!]);
      gl.uniform3fv(loc.light, normalize([toEye[0]! + 0.4, toEye[1]!, toEye[2]! + 0.7]));
      gl.uniform3fv(loc.fill, normalize([-toEye[0]!, -toEye[1]!, 0.3]));
      gl.uniform1i(loc.texture, 0);

      for (const mesh of meshes) {
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.position);
        gl.enableVertexAttribArray(loc.position);
        gl.vertexAttribPointer(loc.position, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normal);
        gl.enableVertexAttribArray(loc.normal);
        gl.vertexAttribPointer(loc.normal, 3, gl.FLOAT, false, 0, 0);
        if (mesh.uv && loc.uv >= 0) {
          gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uv);
          gl.enableVertexAttribArray(loc.uv);
          gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, 0, 0);
        } else if (loc.uv >= 0) {
          gl.disableVertexAttribArray(loc.uv);
          gl.vertexAttrib2f(loc.uv, 0, 0);
        }
        for (const part of mesh.parts) {
          const textured = part.texture !== null && mesh.uv !== null;
          gl.uniform1i(loc.textured, textured ? 1 : 0);
          // Без текстуры — нейтральный серый, чтобы форма была видна.
          gl.uniform4fv(loc.color, textured ? part.color : [0.62, 0.64, 0.68, 1]);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, part.texture);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, part.index);
          gl.drawElements(gl.TRIANGLES, part.count, gl.UNSIGNED_INT, 0);
        }
      }
    };
    drawRef.current = () => requestAnimationFrame(draw);
    draw();

    const observer = new ResizeObserver(() => drawRef.current());
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      drawRef.current = () => undefined;
      for (const b of buffers) gl.deleteBuffer(b);
      for (const t of glTextures.values()) gl.deleteTexture(t);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    };
  }, [model, textures]);

  // Мышь: поворот и приближение.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let dragging: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      dragging = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const v = viewRef.current;
      v.yaw -= (e.clientX - dragging.x) * 0.01;
      v.pitch = Math.max(-1.2, Math.min(1.2, v.pitch + (e.clientY - dragging.y) * 0.01));
      dragging = { x: e.clientX, y: e.clientY };
      drawRef.current();
    };
    const up = () => {
      dragging = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      v.distance = Math.max(0.35, Math.min(2.5, v.distance * (e.deltaY > 0 ? 1.1 : 0.9)));
      drawRef.current();
    };
    const reset = () => {
      viewRef.current = { yaw: 0, pitch: 0.08, distance: 1 };
      drawRef.current();
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("dblclick", reset);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("dblclick", reset);
    };
  }, []);

  // Клавиатура: стрелки поворачивают, +/− приближают.
  const onKey = (e: ReactKeyboardEvent<HTMLCanvasElement>) => {
    const v = viewRef.current;
    if (e.key === "ArrowLeft") v.yaw += 0.15;
    else if (e.key === "ArrowRight") v.yaw -= 0.15;
    else if (e.key === "ArrowUp") v.pitch = Math.min(1.2, v.pitch + 0.1);
    else if (e.key === "ArrowDown") v.pitch = Math.max(-1.2, v.pitch - 0.1);
    else if (e.key === "+" || e.key === "=") v.distance = Math.max(0.35, v.distance * 0.9);
    else if (e.key === "-") v.distance = Math.min(2.5, v.distance * 1.1);
    else return;
    e.preventDefault();
    drawRef.current();
  };

  if (error) return <p className="m-0 rounded-xl bg-surface-2 px-3.5 py-3 text-sm text-ink-2">{error}</p>;
  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      tabIndex={0}
      onKeyDown={onKey}
      className="block w-full cursor-grab touch-none rounded-xl bg-[radial-gradient(ellipse_at_center,#232833_0%,#12151b_75%)] active:cursor-grabbing"
      style={{ height }}
    />
  );
}
