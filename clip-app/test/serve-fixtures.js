'use strict';
// Serves the test pages and videos (test/fixtures.js) until stopped. Prints "READY <address>" once it's up.
// Run: node test/serve-fixtures.js [folder]
const os = require('node:os');
const path = require('node:path');
const { makeMedia, serve } = require('./fixtures.js');
const { findTools } = require('../src/engine.js');

(async () => {
  const tools = findTools([process.env.CLIPS_BIN || path.join(__dirname, '..', 'vendor')]);
  const dir = makeMedia(process.argv[2] || path.join(os.tmpdir(), 'clips-fixtures'), tools.ffmpeg);
  const site = await serve(dir);
  console.log('READY ' + site.url);
})().catch((e) => { console.log('FAILED ' + e.message); process.exit(1); });
