// Ripple lens (effect): ripples run across the loop's picture, rippling harder on the beat. Phosphor Loop original.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec2 c = uv - 0.5;
  c.x *= iResolution.x / iResolution.y;
  float kick = texture(iChannel0, vec2(0.03, 0.25)).r;
  float d = length(c);
  float w = sin(d * 40.0 - iTime * 5.0) * (0.004 + 0.02 * kick) / (1.0 + d * 6.0);
  vec2 q = uv + normalize(c + 1e-5) * w;
  fragColor = vec4(texture(iChannel1, q).rgb * (1.0 + w * 8.0), 1.0);
}
