import * as THREE from "three";
import { createFormMesh, disposeFormMesh } from "./form-mesh-geometry";
import type { FormMeshAsset } from "./form-mesh-asset";

/** One bounded offscreen render; no animation loop, retained context or texture cache. */
export async function renderFormMesh(asset: FormMeshAsset): Promise<HTMLCanvasElement> {
  const root = createFormMesh(asset);
  let renderer: THREE.WebGLRenderer | undefined;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: "low-power" });
    renderer.setPixelRatio(1); renderer.setSize(asset.width, asset.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.setClearColor(0, 0);
    const scene = new THREE.Scene(); scene.add(root);
    const bounds = new THREE.Box3().setFromObject(root), center = bounds.getCenter(new THREE.Vector3());
    const radius = Math.max(0.001, bounds.getSize(new THREE.Vector3()).length() / 2);
    root.position.sub(center);
    const camera = new THREE.PerspectiveCamera(asset.fov, asset.width / asset.height, radius / 1000, radius * 20);
    camera.position.z = radius / Math.sin(THREE.MathUtils.degToRad(asset.fov / 2)) * 1.1;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x424b60, 2));
    const key = new THREE.DirectionalLight(0xffffff, 4); key.position.set(-2, 3, 4); scene.add(key);
    const fill = new THREE.DirectionalLight(0xb6d2ff, 2); fill.position.set(2, -1, 2); scene.add(fill);
    renderer.render(scene, camera);
    if (renderer.getContext().isContextLost()) throw new Error("3D graphics context lost; document unchanged.");
    const canvas = document.createElement("canvas"); canvas.width = asset.width; canvas.height = asset.height;
    const context = canvas.getContext("2d"); if (!context) throw new Error("Unable to allocate the bounded mesh render.");
    context.drawImage(renderer.domElement, 0, 0); return canvas;
  } finally { disposeFormMesh(root); renderer?.dispose(); renderer?.forceContextLoss(); }
}
