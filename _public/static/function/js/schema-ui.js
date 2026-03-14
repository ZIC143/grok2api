function schemaSetTitle(element, value) {
  if (!element || !value) return;
  element.title = String(value);
}

function schemaSetText(element, value) {
  if (!element || !value) return;
  element.textContent = String(value);
}

function schemaEnsureFieldDescription(element, text) {
  if (!element || !text) return null;
  let desc = element.parentElement && element.parentElement.querySelector('.field-dynamic-desc');
  if (!desc) {
    desc = document.createElement('div');
    desc.className = 'field-dynamic-desc';
    desc.style.fontSize = '12px';
    desc.style.opacity = '0.7';
    desc.style.marginTop = '4px';
    if (element.parentElement) {
      element.parentElement.appendChild(desc);
    }
  }
  if (desc) {
    desc.textContent = String(text);
  }
  return desc;
}

function schemaSetSelectOptions(select, options, preferred, formatter) {
  if (!select || !Array.isArray(options) || options.length === 0) return;
  const normalizedOptions = options.map((item) => String(item));
  const preferredValue = preferred !== undefined && preferred !== null ? String(preferred) : '';
  const current = preferredValue && normalizedOptions.includes(preferredValue)
    ? preferredValue
    : (normalizedOptions.includes(String(select.value)) ? String(select.value) : normalizedOptions[0]);

  select.innerHTML = '';
  options.forEach((optionValue) => {
    const normalized = String(optionValue);
    const option = document.createElement('option');
    option.value = normalized;
    option.textContent = typeof formatter === 'function' ? formatter(optionValue) : normalized;
    if (normalized === current) {
      option.selected = true;
    }
    select.appendChild(option);
  });
  select.value = current;
}

function schemaApplySelectField(select, field, formatter) {
  if (!select || !field) return;
  if (Array.isArray(field.options) && field.options.length > 0) {
    schemaSetSelectOptions(select, field.options, field.default, formatter);
  }
}

function schemaUpdateFieldOrder(container, entries) {
  if (!container || !Array.isArray(entries) || entries.length === 0) return;
  const ranked = entries
    .filter((entry) => entry && entry.element)
    .sort((left, right) => (left.order || 0) - (right.order || 0));
  ranked.forEach((entry) => {
    const target = entry.closestSelector
      ? entry.element.closest(entry.closestSelector)
      : (entry.element.closest('.settings-block') || entry.element.closest('.settings-field') || entry.element);
    if (target && target.parentElement === container) {
      container.appendChild(target);
    }
  });
}

function schemaApplySectionLayout(container, sections, sectionElements) {
  if (!container || !Array.isArray(sections) || !sectionElements) return;
  sections.forEach((section) => {
    const sectionEl = sectionElements[section.id];
    if (!sectionEl) return;
    sectionEl.dataset.sectionId = section.id;
    sectionEl.dataset.layout = section.layout || 'stack';
    sectionEl.dataset.columns = String(section.columns || 1);
    if (section.label) {
      sectionEl.dataset.sectionLabel = section.label;
    }
    if (section.description) {
      sectionEl.dataset.sectionDescription = section.description;
      sectionEl.title = section.description;
    }
  });
}

function schemaSetVisibility(element, visible) {
  if (!element) return;
  element.style.display = visible ? '' : 'none';
  element.dataset.schemaVisible = visible ? 'true' : 'false';
}

function schemaApplyFieldWidth(element, width) {
  if (!element || !width) return;
  element.dataset.schemaWidth = String(width);
}

function schemaApplyFieldUiBlock(field, element, options = {}) {
  if (!field || !field.ui || !element) return;
  const ui = field.ui;
  if (ui.label && options.labelElement) {
    schemaSetText(options.labelElement, ui.label);
  }
  if (ui.description) {
    schemaEnsureFieldDescription(options.labelElement || element, ui.description);
  }
  if (ui.description || ui.label) {
    schemaSetTitle(element, ui.description || ui.label);
  }
  if (ui.width) {
    const target = options.widthTarget || element.closest('.settings-block') || element.closest('.settings-field') || element;
    schemaApplyFieldWidth(target, ui.width);
  }
}

window.SchemaUI = {
  setTitle: schemaSetTitle,
  setText: schemaSetText,
  ensureFieldDescription: schemaEnsureFieldDescription,
  setSelectOptions: schemaSetSelectOptions,
  applySelectField: schemaApplySelectField,
  updateFieldOrder: schemaUpdateFieldOrder,
  applySectionLayout: schemaApplySectionLayout,
  setVisibility: schemaSetVisibility,
  applyFieldWidth: schemaApplyFieldWidth,
  applyFieldUiBlock: schemaApplyFieldUiBlock,
};
