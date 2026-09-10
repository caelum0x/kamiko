/*
 * copy_mediapipe.js — put MediaPipe's vision WASM where the browser can fetch it.
 *
 * WHY NOT CopyWebpackPlugin, WHICH IS WHAT THIS REPO USES FOR THE ONNX RUNTIME: those are `.wasm`
 * files, and webpack copies binaries verbatim. MediaPipe ships its WASM alongside JS "glue" loaders,
 * and one of them (`vision_wasm_module_internal.js`) uses `import.meta` — so Terser, which minifies
 * everything that lands in the webpack output, refuses it outright and the whole build fails with
 * "'import.meta' cannot be used outside of module code".
 *
 * These files are not part of the bundle. The FilesetResolver fetches them by URL at runtime, so
 * they belong in `public/`, which Next serves untouched. Hence a copy step rather than a plugin.
 *
 * The destination is gitignored: it is a verbatim copy of a dependency, and committing several
 * megabytes of vendored WASM that `npm ci` already puts on disk is how a repository doubles in size
 * for no reason.
 */
const fs = require('node:fs');
const path = require('node:path');

const from = path.join(__dirname, '..', 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const to = path.join(__dirname, '..', 'public', 'mediapipe', 'wasm');

if (!fs.existsSync(from)) {
  // A WARNING, NOT A FAILURE. Face tracking is one optional feature; a missing optional dependency
  // must not stop the whole front end from building. The tracker reports its own honest error in
  // the browser if somebody turns it on without these.
  console.warn(
    '[mediapipe] @mediapipe/tasks-vision is not installed — skipping the WASM copy. ' +
      'Operator face tracking will not start until `npm ci` has run.',
  );
  process.exit(0);
}

fs.rmSync(to, { recursive: true, force: true });
fs.mkdirSync(to, { recursive: true });
let n = 0;
for (const file of fs.readdirSync(from)) {
  fs.copyFileSync(path.join(from, file), path.join(to, file));
  n++;
}
console.log(`[mediapipe] copied ${n} runtime files to public/mediapipe/wasm`);
