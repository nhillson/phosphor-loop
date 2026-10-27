// Spectrum bars: the music as mirrored glowing bars, bass in the middle. Phosphor Loop original.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float x = abs(uv.x - 0.5) * 2.0;
  float bars = 48.0;
  float b = floor(x * bars) / bars;
  float level = texture(iChannel0, vec2(pow(b, 1.6) * 0.7 + 0.01, 0.25)).r;
  float y = abs(uv.y - 0.5) * 2.0;
  float on = step(y, level * 0.95) * step(0.15, fract(x * bars));
  vec3 col = mix(vec3(0.2, 0.9, 1.0), vec3(1.0, 0.3, 0.8), y);
  col = col * on + col * 0.25 * exp(-12.0 * max(0.0, y - level));
  fragColor = vec4(col, 1.0);
}
