// Local workstation preview, using the same public-asset routes as capture.
import {PassThrough} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {createCaptureServer} from './capture/pipeline.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const input = new PassThrough();
input.resume();
const {server} = createCaptureServer({root, input});
const port = Number(process.env.PORT || 8000);
const host = process.env.HOST || '0.0.0.0';
server.on('error', error => { console.error(error.message); process.exitCode = 1; input.destroy(); });
server.listen(port, host, () => console.log(`Phosphor Loop: http://127.0.0.1:${server.address().port} (listening on ${host})`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.closeAllConnections(); server.close(); input.destroy();
});
