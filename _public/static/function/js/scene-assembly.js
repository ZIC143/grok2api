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

function applySceneMeta(parts, options = {}) {
  if (!parts) return;
  const { scene, schema, ui } = parts;

  if (options.statusElement && ui.description) {
    options.statusElement.textContent = ui.description;
    options.statusElement.title = ui.description;
  }
  if (options.titleElement && ui.title) {
    options.titleElement.textContent = ui.title;
  }
  if (options.submitButton && ui.submit_label) {
    options.submitButton.textContent = ui.submit_label;
    options.submitButton.title = ui.submit_label;
  }
  if (options.layoutElement && Array.isArray(schema.sections)) {
    const layoutSummary = schema.sections
      .map((section) => `${section.label}${section.description ? `：${section.description}` : ''}`)
      .join(' | ');
    if (layoutSummary) {
      options.layoutElement.dataset.layoutHint = layoutSummary;
      options.layoutElement.title = layoutSummary;
    }
    if (schema.ui && schema.ui.title) {
      options.layoutElement.dataset.dynamicTitle = schema.ui.title;
    }
  }
  if (options.visibilityTarget && scene.access) {
    window.SchemaUI.setVisibility(options.visibilityTarget, scene.access.enabled !== false);
  }
}

window.SceneAssembly = {
  getSceneFromManifest,
  createFieldMap,
  getSceneParts,
  applySceneMeta,
};
