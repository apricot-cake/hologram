import { useEffect, useRef } from 'react';
import { continueRender, delayRender, staticFile } from 'remotion';

// Square logo mark rendered via WebGL: the still icon texture is kept in
// perpetual motion by domain-warping its UVs with animated fbm noise.
// `fill` (0..1) reveals the square from the bottom with a wavy meniscus,
// used by the liquid-fill entrance; keep it at 1 for the slide entrance.

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5; // y=0 at the bottom of the square
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uTime;
uniform float uFill;
uniform float uWarp;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

void main() {
  float t = uTime * 0.10;
  vec2 warp = vec2(
    fbm(vUv * 3.0 + vec2(t, -t * 0.7)),
    fbm(vUv * 3.0 + vec2(5.2 - t * 0.8, 1.3 + t))
  ) - vec2(0.5);
  // Texture y is flipped relative to our bottom-up UV space
  vec2 suv = clamp(vec2(vUv.x, 1.0 - vUv.y) + warp * uWarp, 0.0, 1.0);
  vec4 c = texture2D(uTex, suv);

  // Liquid surface: sweep the level a bit past [0,1] so the waves fully
  // clear the bottom and top edges at fill=0 and fill=1.
  float level = uFill * 1.24 - 0.12;
  float wave = 0.035 * sin(vUv.x * 12.0 + uTime * 2.4)
             + 0.045 * (noise(vec2(vUv.x * 4.0 + uTime * 0.9, uTime * 0.6)) - 0.5);
  float edge = level + wave * (1.0 - abs(uFill * 2.0 - 1.0) * 0.6);
  float m = 1.0 - smoothstep(edge - 0.004, edge + 0.004, vUv.y);

  gl_FragColor = vec4(c.rgb * m, m); // premultiplied alpha
}
`;

type GlState = {
  gl: WebGLRenderingContext;
  uTime: WebGLUniformLocation | null;
  uFill: WebGLUniformLocation | null;
  uWarp: WebGLUniformLocation | null;
};

const compile = (gl: WebGLRenderingContext, type: number, src: string) => {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('createShader failed');
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile failed');
  }
  return shader;
};

export const LiquidSquare: React.FC<{
  size: number;
  time: number;
  fill: number;
  warp?: number;
  cornerRadius?: number;
}> = ({ size, time, fill, warp = 0.045, cornerRadius = 0 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GlState | null>(null);
  const uniformsRef = useRef({ time, fill, warp });
  uniformsRef.current = { time, fill, warp };
  const RES = 1024; // fixed backing resolution, independent of display size

  const draw = () => {
    const s = stateRef.current;
    if (!s) return;
    const { gl } = s;
    const u = uniformsRef.current;
    gl.viewport(0, 0, RES, RES);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(s.uTime, u.time);
    gl.uniform1f(s.uFill, u.fill);
    gl.uniform1f(s.uWarp, u.warp);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: one-time GL init; draw only reads refs
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handle = delayRender('liquid-square-init');
    const gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
    });
    if (!gl) throw new Error('WebGL context unavailable');

    const program = gl.createProgram();
    if (!program) throw new Error('createProgram failed');
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed');
    }
    gl.useProgram(program);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const img = new Image();
    img.onload = () => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      stateRef.current = {
        gl,
        uTime: gl.getUniformLocation(program, 'uTime'),
        uFill: gl.getUniformLocation(program, 'uFill'),
        uWarp: gl.getUniformLocation(program, 'uWarp'),
      };
      draw(); // the pending frame is captured right after continueRender
      continueRender(handle);
    };
    img.src = staticFile('icon-master.png');

    return () => {
      stateRef.current = null;
    };
  }, []);

  // Redraw for every frame Remotion asks for
  useEffect(() => {
    draw();
  });

  return (
    <canvas
      ref={canvasRef}
      width={RES}
      height={RES}
      style={{
        width: size,
        height: size,
        borderRadius: cornerRadius,
        display: 'block',
      }}
    />
  );
};
