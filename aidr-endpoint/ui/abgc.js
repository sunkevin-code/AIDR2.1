(function (global) {
  "use strict";

  var MODES = new Set(["permission", "predicted", "actual", "aggregate"]);

  function finiteLevel(value, fallback) {
    var level = Number(value);
    if (!Number.isFinite(level)) level = Number(fallback || 0);
    return Math.max(0, Math.min(5, level));
  }

  function normalizeBoundary(boundary) {
    var source = boundary || {};
    var organization = source.organization || source;
    var task = source.task || {};
    return {
      organization: {
        levels: Object.assign({}, organization.levels || organization.domainLevels || {}),
        maxLevel: finiteLevel(organization.maxLevel, 3),
        allowedAtoms: (organization.allowedAtoms || []).map(function (id) { return String(id).toUpperCase(); }),
        conditionalAtoms: (organization.conditionalAtoms || []).map(function (id) { return String(id).toUpperCase(); }),
        deniedAtoms: (organization.deniedAtoms || []).map(function (id) { return String(id).toUpperCase(); }),
        policyVersion: organization.policyVersion || source.policyVersion || null,
        policyRevision: organization.policyRevision == null ? source.policyRevision : organization.policyRevision,
        version: organization.version || source.policyVersion || null,
        source: organization.source || source.source || "policy.organizationBoundary"
      },
      task: {
        levels: Object.assign({}, task.levels || task.domainLevels || {}),
        maxLevel: finiteLevel(task.maxLevel, organization.maxLevel == null ? 3 : organization.maxLevel),
        allowedAtoms: (task.allowedAtoms || []).map(function (id) { return String(id).toUpperCase(); }),
        conditionalAtoms: (task.conditionalAtoms || []).map(function (id) { return String(id).toUpperCase(); }),
        deniedAtoms: (task.deniedAtoms || []).map(function (id) { return String(id).toUpperCase(); }),
        version: task.version || null,
        source: task.source || "session.taskBoundary"
      }
    };
  }

  function normalizeCatalog(catalog) {
    return (Array.isArray(catalog) ? catalog : []).map(function (atom) {
      return Object.assign({}, atom, {
        id: String(atom && atom.id || "UNMAPPED.UNKNOWN").toUpperCase(),
        domain: String(atom && atom.domain || String(atom && atom.id || "UNMAPPED").split(".")[0]).toUpperCase(),
        baseLevel: finiteLevel(atom && atom.baseLevel, 0),
        enabled: atom && atom.enabled !== false
      });
    });
  }

  function normalizeItems(items) {
    return (Array.isArray(items) ? items : []).map(function (item, index) {
      var copy = Object.assign({}, item);
      copy.atomId = String(copy.atomId || copy.atom_id || "UNMAPPED.UNKNOWN").toUpperCase();
      copy.requiredLevel = finiteLevel(copy.requiredLevel == null ? copy.level : copy.requiredLevel, 0);
      copy.sequence = Number(copy.sequence || index + 1);
      copy.boundaryScope = copy.boundaryScope || copy.boundary_scope || "within";
      copy.verdict = String(copy.verdict || copy.decision || "allow").toLowerCase();
      return copy;
    });
  }

  function createViewModel(input) {
    var source = input || {};
    return {
      mode: MODES.has(source.mode) ? source.mode : "permission",
      boundary: normalizeBoundary(source.boundary),
      catalog: normalizeCatalog(source.catalog),
      items: normalizeItems(source.items),
      decisionTrace: source.decisionTrace || null
    };
  }

  function selectBoundaryAtoms(catalog, boundary, layer, domains) {
    var normalizedCatalog = normalizeCatalog(catalog);
    var normalizedBoundary = normalizeBoundary(boundary);
    var organization = normalizedBoundary.organization;
    var target = layer === "task" ? normalizedBoundary.task : organization;
    var explicitlyAllowed = new Set(organization.allowedAtoms || []);
    var taskAllowed = new Set(target.allowedAtoms || []);
    var denied = new Set(organization.deniedAtoms || []);
    return (Array.isArray(domains) ? domains : []).map(function (domain) {
      var key = String(domain).toUpperCase();
      var organizationLimit = finiteLevel(organization.levels[key], organization.maxLevel);
      var targetLimit = layer === "task"
        ? Math.min(organizationLimit, finiteLevel(target.levels[key], target.maxLevel))
        : organizationLimit;
      var allowed = normalizedCatalog.filter(function (atom) {
        if (atom.domain !== key || atom.enabled === false || denied.has(atom.id)) return false;
        var allowedByOrganization = explicitlyAllowed.has(atom.id);
        if (!allowedByOrganization) return false;
        return layer === "task" ? taskAllowed.has(atom.id) && atom.baseLevel <= targetLimit : true;
      });
      var highestLevel = allowed.reduce(function (highest, atom) { return Math.max(highest, atom.baseLevel); }, -1);
      return {
        domain: key,
        configuredLevel: targetLimit,
        effectiveLevel: highestLevel,
        atoms: allowed.filter(function (atom) { return atom.baseLevel === highestLevel; }).sort(function (a, b) { return a.id.localeCompare(b.id); })
      };
    });
  }

  global.AIDR_ABCG = Object.freeze({
    createViewModel: createViewModel,
    normalizeBoundary: normalizeBoundary,
    normalizeCatalog: normalizeCatalog,
    normalizeItems: normalizeItems,
    selectBoundaryAtoms: selectBoundaryAtoms
  });
})(window);
