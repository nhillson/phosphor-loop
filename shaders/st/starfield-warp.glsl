// Starfield warp: stars streaming past. Phosphor Loop original.
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
  vec3 col = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float depth = fract(iTime * 0.12 + float(i) * 0.25);
    float scale = mix(18.0, 0.6, depth);
    vec2 p = uv * scale + float(i) * 13.1;
    vec2 g = floor(p), f = fract(p) - 0.5;
    float r = h(g);
    vec2 off = vec2(h(g + 1.3), h(g + 7.7)) - 0.5;
    float d = length(f - off * 0.7);
    float star = smoothstep(0.08, 0.0, d) * step(0.75, r) * depth * (1.0 - depth) * 4.0;
    col += star * mix(vec3(0.6, 0.8, 1.0), vec3(1.0, 0.8, 0.6), r);
  }
  fragColor = vec4(col, 1.0);
}
