three.js r170 (MIT, see LICENSE) with its glTF loader and RoomEnvironment, bundled into one plain script
(`three-gltf.js`, sets `window.PhosphorThree`) for the Model input (js/model.js). It's only loaded the first time
a model is shown.

Rebuild:

    npm i three@0.170.0 esbuild
    npx esbuild entry.js --bundle --minify --format=iife --legal-comments=none --outfile=three-gltf.js
