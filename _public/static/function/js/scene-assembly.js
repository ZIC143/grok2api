function getSceneFromManifest(manifest, sceneName) {
  return manifest && manifest.scenes ? manifest.scenes[sceneName] || null : null;
}

function createFieldMap(scene) {
  const schema = scene && scene.schema ? scene.schema : {};
  const fields = Array.isArray(schema.fields) ? schema.fields : [];
  return new Map(fields.map((field) => [field.name, field]));
}

function getSceneParts(manifest, sceneName) {
  const scene = getSceneFromManifest(manifest, sceneName);
  if (!scene) {
    return null;
  }
  return {
    scene,
    bootstrap: scene.bootstrap || {},
    schema: scene.schema || {},
    ui: scene.ui || {},
    fieldMap: createFieldMap(scene),
  };
}

window.SceneAssembly = {
  getSceneFromManifest,
  createFieldMap,
  getSceneParts,
};
