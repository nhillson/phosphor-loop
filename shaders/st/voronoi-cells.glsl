// Voronoi cells: drifting cells with glowing edges. Phosphor Loop original.
vec2 hash2(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.y * 5.0;
  vec2 g = floor(uv), f = fract(uv);
  float d1 = 8.0, d2 = 8.0; vec2 id = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 h = hash2(g + o);
    vec2 p = o + 0.5 + 0.45 * sin(iTime * 0.6 + 6.2831 * h) - f;
    float d = dot(p, p);
    if (d < d1) { d2 = d1; d1 = d; id = g + o; } else if (d < d2) d2 = d;
  }
  float edge = smoothstep(0.0, 0.08, sqrt(d2) - sqrt(d1));
  vec3 base = 0.5 + 0.5 * cos(6.2831 * hash2(id).x + vec3(0.0, 2.0, 4.0));
  vec3 col = mix(vec3(1.0, 0.95, 1.0), base * 0.7, edge);
  fragColor = vec4(col, 1.0);
}
