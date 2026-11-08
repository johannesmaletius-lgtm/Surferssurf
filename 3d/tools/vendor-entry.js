// Baut 3d/vendor/three.min.js: Three.js plus die benötigten Zusatzmodule in einer Datei.
// Neu bauen (einmalig npm i three esbuild im Ordner 3d/tools):
//   npx esbuild vendor-entry.js --bundle --format=esm --minify --legal-comments=eof --outfile=../vendor/three.min.js
export * from 'three';
export { Sky } from 'three/addons/objects/Sky.js';
export { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
export { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
export { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
export { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
export { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
export { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
