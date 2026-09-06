/**
 * CRT 后处理 shader（阶段二）——移植自 typed-crt（MIT License）
 * https://github.com/Steve245270533/typed-crt  src/effects/crt/crtShaders.ts
 *
 * 管线：文字由 CrtRenderer 画进离屏 2D canvas → 作为纹理 uTex 上传 →
 * 本 pass 做桶形弯曲/色差/扫描线/RGB 荫罩/滚动亮带/暗角/闪烁/噪点/溢光。
 * 文字本身不由 shader 绘制——WebGL 只是"照片滤镜"。
 */

export const CRT_VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const CRT_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uTime;
uniform float uMotion;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 uv = vUv;

  // 桶形弯曲（typed-crt 常量：水平 0.115 / 垂直 0.165）
  vec2 cuv = uv * 2.0 - 1.0;
  vec2 off = abs(cuv.yx);
  cuv += cuv * off * vec2(0.115, 0.165);
  uv = cuv * 0.5 + 0.5;

  // 屏幕外的"房间"底色 + 磷光溢出（CRT 的光洒在墙上）
  float dCenter = length((uv - 0.5) * vec2(1.05, 1.0));
  float spill = smoothstep(0.85, 0.18, dCenter) * 0.05;
  vec3 room = vec3(0.02, 0.03, 0.02) + vec3(0.0, spill * 0.6, spill * 0.42);

  // 屏幕外裁剪
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(room, 1.0);
    return;
  }

  vec3 col = texture2D(uTex, uv).rgb;

  // 径向色差：R/B 通道随离心距反向偏移（0.0016 + 0.012*d²）
  vec2 dir = uv - 0.5;
  float d2 = dot(dir, dir);
  vec2 caOff = dir * (0.0016 + 0.012 * d2);
  col.r = texture2D(uTex, uv + caOff).r;
  col.b = texture2D(uTex, uv - caOff).b;

  // 扫描线：0.92 倍屏高线频，亮度下压到 70%
  float s = sin(uv.y * uRes.y * 0.92);
  col *= mix(0.70, 1.0, s * s);

  // RGB 荫罩：每 3 像素一周期余弦遮罩，1.34 增益补偿
  float px = uv.x * uRes.x;
  vec3 mask = 0.66 + 0.34 * cos(6.28318530718 * (px / 3.0) + vec3(0.0, 2.0943951, 4.1887902));
  col *= mask * 1.34;

  // 滚动亮带：0.07 周期/秒，强度 0.045
  float band = fract(uv.y * 0.5 - uTime * 0.07 * uMotion);
  col *= 1.0 - 0.045 * band;

  // 暗角：角部亮度降至 42%
  float vig = smoothstep(0.98, 0.30, length((uv - 0.5) * vec2(1.05, 1.0)));
  col *= mix(0.42, 1.0, vig);

  // 闪烁：2.8% 幅度
  col *= 1.0 - 0.028 * uMotion * sin(uTime * 8.0);

  // 动态噪点：±1.1%
  col += (hash(uv * fract(uTime * 0.37) * 100.0) - 0.5) * 0.022;

  // 磷光底色：永不纯黑，暗部带微绿
  col = max(col, vec3(0.004, 0.010, 0.008));
  gl_FragColor = vec4(col + spill * 0.3, 1.0);
}
`;
