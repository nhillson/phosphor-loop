// Plasma bloom: soft colour plasma that swells with the bass. Phosphor Loop original.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
  float bass = texture(iChannel0, vec2(0.04, 0.25)).r;
  float t = iTime * 0.35;
  float v = sin(uv.x * 6.0 + t) + sin(uv.y * 7.0 - t * 1.3) + sin((uv.x + uv.y) * 5.0 + t * 0.7);
  v += sin(length(uv * (4.0 + 3.0 * bass)) * 6.0 - t * 2.0);
  vec3 col = 0.5 + 0.5 * cos(v * 0.9 + vec3(0.0, 2.1, 4.2) + t);
  col *= 0.75 + 0.6 * bass;
  fragColor = vec4(col, 1.0);
}
