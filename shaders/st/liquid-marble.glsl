// Liquid marble: slowly folding marbled colour. Phosphor Loop original.
float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 9871.13); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.y * 2.5;
  float t = iTime * 0.08;
  vec2 q = vec2(fbm(uv + t), fbm(uv + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(uv + 4.0 * q + vec2(1.7, 9.2) + t * 1.5), fbm(uv + 4.0 * q + vec2(8.3, 2.8)));
  float f = fbm(uv + 4.0 * r);
  vec3 col = mix(vec3(0.1, 0.05, 0.25), vec3(0.9, 0.4, 0.7), clamp(f * f * 2.0, 0.0, 1.0));
  col = mix(col, vec3(0.2, 0.8, 0.9), clamp(length(q) * 0.6, 0.0, 1.0));
  col = mix(col, vec3(1.0, 0.95, 0.85), clamp(r.x * r.x * 0.8, 0.0, 1.0));
  fragColor = vec4(col, 1.0);
}
