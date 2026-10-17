'use strict';
// Keep popup styles inline so its generated document is styled synchronously, including file://.
window.PhosphorOutputHTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Phosphor Loop Output</title>
<style>
html,body{margin:0;height:100%;background:#000;overflow:hidden}
canvas{display:block;width:100vw;height:100vh;touch-action:none}
body.idle,body.idle canvas{cursor:none}
.fsx{position:fixed;top:16px;right:16px;display:none;align-items:center;gap:10px;min-height:52px;padding:10px 20px;border-radius:999px;
  border:1px solid #8b1ab8;background:rgba(11,10,12,.82);color:#f2d9fc;font:600 18px/1 Barlow,"Helvetica Neue",Arial,sans-serif;
  cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.5);transition:opacity .4s}
.fsx:hover{background:rgba(67,31,81,.92)}
.fsx .x{font-size:22px;line-height:1}
body.fs .fsx{display:inline-flex}
body.idle .fsx{opacity:0;pointer-events:none}
.hint{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);width:max-content;max-width:min(560px,90vw);box-sizing:border-box;
  padding:12px 16px;border-radius:10px;background:rgba(11,10,12,.86);border:1px solid rgba(255,255,255,.14);
  color:#e4dae8;font:15px/1.45 Barlow,"Helvetica Neue",Arial,sans-serif;text-align:center;transition:opacity .4s}
.hint.gone,body.idle .hint{opacity:0;pointer-events:none}
.hint b{color:#8b1ab8}
.hint button{margin-top:8px;min-height:34px;padding:5px 14px;border-radius:6px;border:1px solid #37313a;background:#322c35;color:#e4dae8;font:inherit;cursor:pointer}
.show .hint button{min-height:60px;padding:12px 30px;font-size:21px;font-weight:600;border-color:#8b1ab8;background:#431f51;color:#f2d9fc}
</style></head><body><canvas id="out"></canvas>
<div class="hint" id="hint"><span id="hintText">Drag this window onto your projector or second screen, then <b>double-click the picture</b> (or press F) to fill it.</span><br><button id="other" hidden>Fill my other screen</button></div>
<button class="fsx" id="fsx"><span class="x" aria-hidden="true">✕</span>Exit full screen</button>
</body></html>`;
