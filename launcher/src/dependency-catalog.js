"use strict";

const SUPPORTED_DEPENDENCIES = {
  "kava": {
    slug: "kava",
    label: "Kava",
    type: "theme",
    wp_slug: "kava",
    zip_root: "kava",
    identity_file: "kava/style.css",
    version_header: "Version"
  },
  "jet-engine": {
    slug: "jet-engine",
    label: "JetEngine",
    type: "plugin",
    wp_slug: "jet-engine",
    zip_root: "jet-engine",
    identity_file: "jet-engine/jet-engine.php",
    version_header: "Version"
  },
  "jet-smart-filters": {
    slug: "jet-smart-filters",
    label: "JetSmartFilters",
    type: "plugin",
    wp_slug: "jet-smart-filters",
    zip_root: "jet-smart-filters",
    identity_file: "jet-smart-filters/jet-smart-filters.php",
    version_header: "Version"
  },
  "jet-form-builder": {
    slug: "jet-form-builder",
    label: "JetFormBuilder",
    type: "plugin",
    wp_slug: "jetformbuilder",
    zip_root: "jetformbuilder",
    identity_file: "jetformbuilder/jet-form-builder.php",
    version_header: "Version"
  }
};

function listDependencyDefinitions() {
  return Object.keys(SUPPORTED_DEPENDENCIES).map((key) => Object.assign({}, SUPPORTED_DEPENDENCIES[key]));
}

function resolveDependencyDefinition(slug) {
  const key = String(slug || "").trim().toLowerCase();
  const dependency = SUPPORTED_DEPENDENCIES[key];

  if (!dependency) {
    const error = new Error(
      "Unsupported dependency. Allowed values: " + Object.keys(SUPPORTED_DEPENDENCIES).join(", ")
    );
    error.code = "unsupported_dependency";
    throw error;
  }

  return Object.assign({}, dependency);
}

module.exports = {
  SUPPORTED_DEPENDENCIES,
  listDependencyDefinitions,
  resolveDependencyDefinition
};
