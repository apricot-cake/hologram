// 「このアプリについて」のパネル用の、動くホログラフィックなアプリアイコンのシェーダ。
//
// 静的なアプリアイコン（assets/icon.png）を生成した Claude Design のソース（案1.dc.html）の
// WebGL のフラグメントシェーダを移植したもの。これで「このアプリについて」の面が、アイコンを
// 生きた状態で出せる。自己完結していて依存が無く、CSP にも適合する（script-src 'self' の下の
// 独立したファイルで、埋め込みには一切しない）。
//
// 使い方: import { mount } from './about-icon.ts'; mount(canvasEl) → { destroy() }。
// ループはキャンバスが実際に画面に出ている間だけ走り（IntersectionObserver がゲートする）、
// prefers-reduced-motion では動かさずに静止した1フレームだけを描く＝どちらも DESIGN.md に
// 従っている（GPU の節約と、動きの拒否）。

// 設計から焼き込んだ調整の既定値（色相 36° / 彩度 0.85 / パステル 0.2 / 粒度 1.2 / にじみ 0）。
const P = { hue: 36 / 360, sat: 0.85, pastel: 0.2, grain: 1.2, disp: 0 };
// 動きを抑える時に出すフレーム＝平坦な t=0 ではなく、渦が育った状態。
const STATIC_T = 6.0;
const MAX_DPR = 2; // 高解像度の負荷を頭打ちにする。アイコンは小さい

const VS = 'attribute vec2 p; void main(){ gl_Position = vec4(p,0.0,1.0); }';
const FS = [
  'precision highp float;',
  'uniform vec2 u_res;',
  'uniform float u_time;',
  'uniform float u_hue, u_sat, u_pastel, u_grain, u_disp;',
  'vec2 hash22(vec2 p){',
  '  p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3)));',
  '  return fract(sin(p)*43758.5453)*2.0-1.0;',
  '}',
  'float noise(vec2 p){',
  '  vec2 i=floor(p), f=fract(p);',
  '  vec2 u=f*f*(3.0-2.0*f);',
  '  float a=dot(hash22(i), f);',
  '  float b=dot(hash22(i+vec2(1.0,0.0)), f-vec2(1.0,0.0));',
  '  float c=dot(hash22(i+vec2(0.0,1.0)), f-vec2(0.0,1.0));',
  '  float d=dot(hash22(i+vec2(1.0,1.0)), f-vec2(1.0,1.0));',
  '  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);',
  '}',
  'float fbm(vec2 p){',
  '  float v=0.0, a=0.5;',
  '  for(int i=0;i<4;i++){ v+=a*noise(p); p=p*2.02; a*=0.5; }',
  '  return v;',
  '}',
  // 選び抜いたホログラフィックな色の節を通る、玉虫色のパレット（ミント→青→ラベンダー→ピンク→ピーチ）
  'vec3 pal(float t){',
  '  t = fract(t);',
  '  vec3 c0 = vec3(0.52,0.92,0.84);',
  '  vec3 c1 = vec3(0.54,0.78,1.00);',
  '  vec3 c2 = vec3(0.76,0.64,1.00);',
  '  vec3 c3 = vec3(1.00,0.70,0.92);',
  '  vec3 c4 = vec3(1.00,0.85,0.80);',
  '  float s = t*5.0; vec3 c;',
  '  if(s<1.0) c=mix(c0,c1,s);',
  '  else if(s<2.0) c=mix(c1,c2,s-1.0);',
  '  else if(s<3.0) c=mix(c2,c3,s-2.0);',
  '  else if(s<4.0) c=mix(c3,c4,s-3.0);',
  '  else c=mix(c4,c0,s-4.0);',
  '  return mix(c, vec3(1.0), u_pastel);',
  '}',
  'void main(){',
  '  vec2 uv = gl_FragCoord.xy/u_res;',
  '  vec2 p = uv*u_grain;',
  '  float t = u_time*0.04;',
  '  vec2 q = vec2(fbm(p + vec2(0.0,t)), fbm(p + vec2(5.2,1.3) - t));',
  '  vec2 r = vec2(fbm(p + 3.5*q + vec2(1.7,9.2)), fbm(p + 3.5*q + vec2(8.3,2.8)));',
  '  float f = fbm(p + 3.5*r);',
  '  float hue = f*1.9 + length(r)*0.9 + u_hue;',
  '  float d = (0.06 + 0.05*length(r)) * u_disp;',
  '  vec3 col;',
  '  col.r = pal(hue + d).r;',
  '  col.g = pal(hue).g;',
  '  col.b = pal(hue - d).b;',
  '  float lum = dot(col, vec3(0.299,0.587,0.114));',
  '  col = mix(vec3(lum), col, u_sat);',
  '  float crest = smoothstep(0.55, 0.98, f + 0.5);',
  '  col += vec3(1.0,0.98,1.0) * pow(crest, 3.0) * 0.4;',
  '  gl_FragColor = vec4(col, 1.0);',
  '}',
].join('\n');

export function mount(canvas: HTMLCanvasElement | null): { destroy(): void } {
  if (!canvas) return { destroy() {} };
  // ここで一度だけ型を絞る。下の入れ子の関数宣言は `canvas` を参照で捕まえるので、TS は
  // それらの閉包越しには上の防ぎを見られない。
  const cv: HTMLCanvasElement = canvas;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // WebGL のコンテキスト／プログラム／uniform の位置の一式は、この閉包の私的なもの
  // （HologramAboutIcon.mount() の destroy() の面より外へ出ることはない）なので、`any` が
  // 現実的な型＝app/src/main/index.ts のタイマーの変数と同じ判断で、互いに再帰するこれらの
  // 閉包すべてに本物の null 絞りを通しても、呼び出し側のいない儀式にしかならない。
  let gl: any = null,
    prog: any = null,
    uniforms: any = null;
  let raf = 0,
    start = 0,
    running = false,
    visible = false,
    sized = false,
    dead = false;

  function compile(type: number, src: string) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
    return s;
  }

  function initGL() {
    gl = cv.getContext('webgl', { premultipliedAlpha: false, antialias: true });
    if (!gl || gl.isContextLost()) {
      gl = null;
      return false;
    }
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram は WebGL の API のメソッドで React のフックではない＝名前がたまたま似ているだけ
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    uniforms = {
      res: gl.getUniformLocation(prog, 'u_res'),
      time: gl.getUniformLocation(prog, 'u_time'),
      hue: gl.getUniformLocation(prog, 'u_hue'),
      sat: gl.getUniformLocation(prog, 'u_sat'),
      pastel: gl.getUniformLocation(prog, 'u_pastel'),
      grain: gl.getUniformLocation(prog, 'u_grain'),
      disp: gl.getUniformLocation(prog, 'u_disp'),
    };
    // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram は WebGL の API のメソッドで React のフックではない＝名前がたまたま似ているだけ
    gl.useProgram(prog);
    gl.uniform1f(uniforms.hue, P.hue);
    gl.uniform1f(uniforms.sat, P.sat);
    gl.uniform1f(uniforms.pastel, P.pastel);
    gl.uniform1f(uniforms.grain, P.grain);
    gl.uniform1f(uniforms.disp, P.disp);
    sized = false;
    return true;
  }

  function resize() {
    if (!gl) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const css = cv.clientWidth || cv.offsetWidth || 0;
    if (!css) return; // まだ隠れている／大きさが 0＝見えるようになる時まで待つ
    const px = Math.max(1, Math.round(css * dpr));
    if (cv.width !== px || cv.height !== px) {
      cv.width = px;
      cv.height = px;
    }
    gl.viewport(0, 0, cv.width, cv.height);
    gl.uniform2f(uniforms.res, cv.width, cv.height);
    sized = true;
  }

  function drawAt(tSeconds: number) {
    if (!gl || gl.isContextLost()) return;
    if (!sized) {
      resize();
      if (!sized) return;
    }
    gl.uniform1f(uniforms.time, tSeconds);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function frame(now: number) {
    if (!running) return;
    if (!start) start = now;
    drawAt((now - start) / 1000);
    raf = requestAnimationFrame(frame);
  }

  function play() {
    if (running || dead || reduce) return;
    if (!gl && !initGL()) return;
    running = true;
    start = 0;
    raf = requestAnimationFrame(frame);
  }
  function pause() {
    running = false;
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  // 描画のゲート。実際に画面に出ている間だけ走らせる。display:none やオーバーレイを閉じた
  // 状態 → 比 0 → 一時停止。動きを抑える設定なら、最初に現れた時に静止した1フレームを描く。
  const io = new IntersectionObserver(
    (entries) => {
      const e = entries[entries.length - 1];
      visible = e.isIntersecting && e.intersectionRatio > 0;
      if (visible) {
        if (reduce) {
          if (!gl && !initGL()) return;
          resize();
          drawAt(STATIC_T);
        } else {
          play();
        }
      } else {
        pause();
      }
    },
    { threshold: 0.01 },
  );
  io.observe(cv);

  // ウィンドウ全体が隠れた時（最小化）は止める。main では backgroundThrottling を切って
  // あるので、そうしないと rAF が発火し続ける。
  const onVis = () => {
    if (document.visibilityState === 'hidden') pause();
    else if (visible && !reduce) play();
  };
  document.addEventListener('visibilitychange', onVis);

  const ro =
    'ResizeObserver' in window
      ? new ResizeObserver(() => {
          sized = false;
          if (reduce && gl && visible) {
            resize();
            drawAt(STATIC_T);
          }
        })
      : null;
  if (ro) ro.observe(cv);

  const onLost = (ev: Event) => {
    ev.preventDefault();
    pause();
    gl = null;
    sized = false;
  };
  const onRestored = () => {
    if (initGL() && visible) {
      if (reduce) {
        resize();
        drawAt(STATIC_T);
      } else play();
    }
  };
  cv.addEventListener('webglcontextlost', onLost, false);
  cv.addEventListener('webglcontextrestored', onRestored, false);

  return {
    destroy() {
      dead = true;
      pause();
      try {
        io.disconnect();
      } catch (_) {}
      try {
        ro && ro.disconnect();
      } catch (_) {}
      document.removeEventListener('visibilitychange', onVis);
      cv.removeEventListener('webglcontextlost', onLost);
      cv.removeEventListener('webglcontextrestored', onRestored);
      if (gl) {
        const e = gl.getExtension('WEBGL_lose_context');
        if (e) e.loseContext();
      }
      gl = null;
    },
  };
}
