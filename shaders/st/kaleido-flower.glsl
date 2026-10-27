// Kaleido flower: a turning eight-way flower of colour. Phosphor Loop original.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
  float a = atan(uv.y, uv.x), r = length(uv);
  float n = 8.0;
  a = abs(mod(a + iTime * 0.15, 6.2831 / n) - 3.14159 / n);
  vec2 p = vec2(cos(a), sin(a)) * r;
  float v = sin(p.x * 18.0 - iTime) * cos(p.y * 22.0 + iTime * 0.7) + sin(r * 14.0 - iTime * 1.5);
  vec3 col = 0.5 + 0.5 * cos(3.0 * v + r * 4.0 + vec3(0.0, 2.0, 4.0) + iTime * 0.3);
  col *= smoothstep(0.75, 0.2, r);
  fragColor = vec4(col, 1.0);
}
