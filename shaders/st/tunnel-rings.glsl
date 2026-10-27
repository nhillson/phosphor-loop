// Tunnel rings: flying down a ringed tunnel; the rings flash on the beat. Phosphor Loop original.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
  float r = length(uv), a = atan(uv.y, uv.x);
  float z = 0.3 / max(r, 0.02) + iTime * 1.2;
  float kick = texture(iChannel0, vec2(0.03, 0.25)).r;
  float rings = smoothstep(0.42, 0.5, abs(fract(z) - 0.5));
  float spokes = 0.5 + 0.5 * cos(a * 8.0 + z * 0.5);
  vec3 col = mix(vec3(0.05, 0.02, 0.12), vec3(0.4, 0.2, 1.0), spokes * 0.6);
  col += rings * mix(vec3(0.2, 0.9, 1.0), vec3(1.0, 0.4, 0.9), fract(floor(z) * 0.37)) * (0.6 + 1.4 * kick);
  col *= smoothstep(0.0, 0.25, r);
  fragColor = vec4(col, 1.0);
}
