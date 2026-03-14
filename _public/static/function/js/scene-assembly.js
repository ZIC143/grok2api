function getSceneFromManifest(manifest, sceneName) {
  return manifest && manifest.scenes ? manifest.scenes[sceneName] || null : null;
}

function createFieldMap(scene) {
  const schema = scene && scene.schema ? scene.schema : {};
  const fields = Array.isArray(schema.fields) ? schema.fields : [];
  return new Map(fields.map((field) => [field.name, field]));
}

function resolveFieldContainer(element) {
  if (!element) return null;
  return element.closest('.settings-block') || element.closest('.settings-field') || element;
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

function applySceneSections(parts, options = {}) {
  if (!parts) return;
  const { schema, fieldMap } = parts;
  if (options.orderContainer && Array.isArray(options.orderEntries)) {
    const entries = options.orderEntries.map((entry) => ({
      ...entry,
      order: entry.fieldName && fieldMap.get(entry.fieldName) && fieldMap.get(entry.fieldName).ui
        ? fieldMap.get(entry.fieldName).ui.order
        : entry.order,
    }));
    window.SchemaUI.updateFieldOrder(options.orderContainer, entries);
  }
  if (options.layoutContainer && options.sectionElements) {
    window.SchemaUI.applySectionLayout(options.layoutContainer, schema.sections || [], options.sectionElements);
    window.SchemaUI.applySectionPresentation(options.layoutContainer, schema.sections || [], options.sectionElements);
  }
}

function applySceneFields(parts, options = {}) {
  if (!parts || !Array.isArray(options.fieldHandlers)) return;
  const { fieldMap } = parts;
  options.fieldHandlers.forEach((handler) => {
    if (!handler || !handler.fieldName || typeof handler.apply !== 'function') return;
    const field = fieldMap.get(handler.fieldName);
    handler.apply(field, parts);
  });
}

function applyFieldRenderPlan(parts, renderPlan = []) {
  if (!parts || !Array.isArray(renderPlan)) return;
  applySceneFields(parts, {
    fieldHandlers: renderPlan.map((entry) => ({
      fieldName: entry && entry.fieldName,
      apply: (field) => {
        if (!entry || !entry.element || !field) return;
        if (typeof entry.when === 'function' && !entry.when(field, parts)) return;
        if (entry.kind === 'select') {
          window.SchemaUI.renderSelectField(entry.element, field, {
            labelElement: entry.labelElement,
            widthTarget: entry.widthTarget,
            formatter: entry.formatter,
          });
          return;
        }
        if (entry.kind === 'range') {
          window.SchemaUI.renderRangeField(entry.element, field, {
            labelElement: entry.labelElement,
            widthTarget: entry.widthTarget,
          });
          return;
        }
        if (entry.kind === 'text') {
          window.SchemaUI.renderTextField(entry.element, field, {
            labelElement: entry.labelElement,
            widthTarget: entry.widthTarget,
          });
          return;
        }
        if (typeof entry.apply === 'function') {
          entry.apply(field, parts);
        }
      },
    })),
  });
}

function applyFieldUiPlan(parts, uiPlan = []) {
  if (!parts || !Array.isArray(uiPlan)) return;
  applySceneFields(parts, {
    fieldHandlers: uiPlan.map((entry) => ({
      fieldName: entry && entry.fieldName,
      apply: (field) => {
        if (!entry || !entry.element || !field || !field.ui) return;
        const title = field.ui.description || field.ui.label;
        if (title) {
          window.SchemaUI.setTitle(entry.element, title);
        }
        if (entry.placeholderElement && field.ui.label && !entry.placeholderElement.placeholder) {
          entry.placeholderElement.placeholder = field.ui.label;
        }
        if (typeof entry.apply === 'function') {
          entry.apply(field, parts);
        }
      },
    })),
  });
}

function applyBootstrapDefaults(parts, options = {}) {
  if (!parts) return;
  const { bootstrap, fieldMap } = parts;
  const defaults = bootstrap && bootstrap.defaults ? bootstrap.defaults : {};
  const sourceOptions = bootstrap && bootstrap.options ? bootstrap.options : {};

  if (Array.isArray(options.optionBindings)) {
    options.optionBindings.forEach((binding) => {
      if (!binding || !binding.element || !binding.fieldName) return;
      const field = fieldMap.get(binding.fieldName);
      const optionValues = binding.optionsKey && Array.isArray(sourceOptions[binding.optionsKey])
        ? sourceOptions[binding.optionsKey]
        : (field && Array.isArray(field.options) ? field.options : []);
      if (!optionValues.length) return;
      const preferred = binding.defaultKey && defaults[binding.defaultKey] !== undefined
        ? defaults[binding.defaultKey]
        : (field ? field.default : undefined);
      window.SchemaUI.setSelectOptions(binding.element, optionValues, preferred, binding.formatter);
    });
  }

  if (Array.isArray(options.valueBindings)) {
    options.valueBindings.forEach((binding) => {
      if (!binding || !binding.element || !binding.defaultKey) return;
      const value = defaults[binding.defaultKey];
      if (value === undefined || value === null) return;
      if (typeof binding.apply === 'function') {
        binding.apply(value, parts);
        return;
      }
      binding.element.value = String(value);
    });
  }
}

function applyScenePresentation(parts, options = {}) {
  if (!parts) return;
  applySceneMeta(parts, options.meta || {});
  applySceneSections(parts, options.sections || {});
}

function applyScenePresentationPlan(parts, plan = {}) {
  if (!parts) return;
  const orderEntries = Array.isArray(plan.orderFields)
    ? plan.orderFields.map((entry) => ({
        element: entry && entry.element,
        fieldName: entry && entry.fieldName,
        order: entry && entry.order,
        closestSelector: entry && entry.closestSelector,
      }))
    : [];

  applyScenePresentation(parts, {
    meta: plan.meta || {},
    sections: {
      orderContainer: plan.orderContainer,
      orderEntries,
      layoutContainer: plan.layoutContainer,
      sectionElements: plan.sectionElements || {},
    },
  });
}

function getBootstrapModelConfig(parts) {
  if (!parts || !parts.bootstrap || !parts.bootstrap.models) {
    return { available: [], preferred: '' };
  }
  const models = parts.bootstrap.models;
  return {
    available: Array.isArray(models.available) ? models.available.slice() : [],
    preferred: models.preferred ? String(models.preferred) : '',
  };
}

function getBootstrapNumber(parts, key, fallback = null) {
  if (!parts || !parts.bootstrap || !key) return fallback;
  const raw = parts.bootstrap[key];
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

window.SceneAssembly = {
  getSceneFromManifest,
  createFieldMap,
  getSceneParts,
  resolveFieldContainer,
  applySceneMeta,
  applySceneSections,
  applySceneFields,
  applyFieldRenderPlan,
  applyFieldUiPlan,
  applyBootstrapDefaults,
  applyScenePresentation,
  applyScenePresentationPlan,
  getBootstrapModelConfig,
  getBootstrapNumber,
};
