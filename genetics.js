/**
 * SanusBio Genetics Module — Coefficient of Inbreeding (CoI / F) &
 * Coefficient of Relationship (R)
 *
 * Uses Wright’s path method with memoization.
 * Suitable for colony sizes of several hundred animals.
 *
 * Usage:
 *   const genetics = require('./genetics');
 *   const graph = await genetics.buildPedigree(pool);   // or pass rows
 *   const F = genetics.inbreedingCoefficient(graph, id);
 *   const R = genetics.relationshipCoefficient(graph, id1, id2);
 */

'use strict';

/**
 * Build an in-memory pedigree structure from DB rows or a connection pool.
 * @param {Array|{query:Function}} source - either array of {id, mother_id, father_id, ...} or a mysql2 pool
 * @returns {Promise<Object>} graph
 */
async function buildPedigree(source) {
  let rows;
  if (Array.isArray(source)) {
    rows = source;
  } else {
    // assume pool / connection with .query
    const [r] = await source.query(`
      SELECT Ferret_QR005_id AS id,
             animal_id,
             ferret_name AS name,
             sex,
             birth_date,
             mother_id,
             father_id,
             acquisition_class,
             dead,
             distributed
      FROM ferret_qr005
    `);
    rows = r;
  }

  const byId = new Map();
  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      animal_id: row.animal_id,
      name: row.name,
      sex: row.sex,
      birth_date: row.birth_date,
      mother_id: row.mother_id || null,
      father_id: row.father_id || null,
      acquisition_class: row.acquisition_class,
      dead: row.dead,
      distributed: row.distributed,
    });
  }

  // Basic cycle / self-reference sanitization
  for (const [id, node] of byId) {
    if (node.mother_id === id) node.mother_id = null;
    if (node.father_id === id) node.father_id = null;
    if (node.mother_id && !byId.has(node.mother_id)) node.mother_id = null;
    if (node.father_id && !byId.has(node.father_id)) node.father_id = null;
  }

  return {
    byId,
    // simple caches that live with the graph
    _fCache: new Map(),      // id → F
    _phiCache: new Map(),    // "minId:maxId" → coancestry φ
  };
}

/** Clear memoization caches (call after pedigree edits) */
function clearCaches(graph) {
  graph._fCache.clear();
  graph._phiCache.clear();
}

/**
 * Coancestry (kinship) coefficient φ between two individuals.
 * φ(x,x) = 0.5 * (1 + F_x)
 * φ(x,y) = average of φ to the parents of the newer individual, etc.
 * Implemented via recursive path / tabular-style with heavy memoization.
 */
function coancestry(graph, a, b) {
  if (a == null || b == null) return 0;
  if (a === b) {
    return 0.5 * (1 + inbreedingCoefficient(graph, a));
  }

  // Canonical key for unordered pair
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const key = lo + ':' + hi;
  if (graph._phiCache.has(key)) return graph._phiCache.get(key);

  const nodeA = graph.byId.get(a);
  const nodeB = graph.byId.get(b);
  if (!nodeA || !nodeB) {
    graph._phiCache.set(key, 0);
    return 0;
  }

  // To avoid infinite recursion on cycles we use a path-visited approach
  // for the classic common-ancestor summation.
  // For performance & simplicity we use the recursive definition:
  // Order by birth_date when available so we always recurse toward founders.

  let result;

  // Prefer the animal that is "younger" (higher id or later birth) as the one whose parents we expand
  const dateA = nodeA.birth_date ? new Date(nodeA.birth_date).getTime() : 0;
  const dateB = nodeB.birth_date ? new Date(nodeB.birth_date).getTime() : 0;

  if (dateA > dateB || (dateA === dateB && a > b)) {
    // expand a
    const s = nodeA.father_id;
    const d = nodeA.mother_id;
    result = 0.5 * (coancestry(graph, s, b) + coancestry(graph, d, b));
  } else {
    // expand b
    const s = nodeB.father_id;
    const d = nodeB.mother_id;
    result = 0.5 * (coancestry(graph, a, s) + coancestry(graph, a, d));
  }

  graph._phiCache.set(key, result);
  return result;
}

/**
 * Inbreeding coefficient F_x = coancestry of the two parents.
 */
function inbreedingCoefficient(graph, id) {
  if (id == null) return 0;
  if (graph._fCache.has(id)) return graph._fCache.get(id);

  const node = graph.byId.get(id);
  if (!node) {
    graph._fCache.set(id, 0);
    return 0;
  }

  const s = node.father_id;
  const d = node.mother_id;
  let F = 0;
  if (s != null && d != null) {
    F = coancestry(graph, s, d);
  }
  // Clamp tiny floating-point noise
  if (F < 1e-12) F = 0;
  if (F > 1) F = 1;

  graph._fCache.set(id, F);
  return F;
}

/**
 * Wright’s coefficient of relationship (correlation of breeding values).
 * R_xy = 2 φ_xy / sqrt( (1+F_x)(1+F_y) )
 */
function relationshipCoefficient(graph, id1, id2) {
  if (id1 === id2) return 1;
  const phi = coancestry(graph, id1, id2);
  const Fx = inbreedingCoefficient(graph, id1);
  const Fy = inbreedingCoefficient(graph, id2);
  const denom = Math.sqrt((1 + Fx) * (1 + Fy));
  if (denom === 0) return 0;
  return (2 * phi) / denom;
}

/**
 * Human-readable interpretation of an inbreeding coefficient.
 */
function interpretCoi(F) {
  if (F < 0.03125) return { level: 'very_low', label: 'Very low (< 3.125%)', detail: 'Essentially outbred' };
  if (F < 0.0625)  return { level: 'low', label: 'Low (< 6.25%)', detail: '≈ second cousins or less' };
  if (F < 0.125)   return { level: 'moderate', label: 'Moderate (6.25–12.5%)', detail: '≈ first cousins once removed / half first cousins' };
  if (F < 0.25)    return { level: 'notable', label: 'Notable (12.5–25%)', detail: '≈ first cousins range' };
  if (F < 0.5)     return { level: 'high', label: 'High (25–50%)', detail: '≈ half-sibs / grandparent–grandchild / uncle–niece' };
  return { level: 'very_high', label: 'Very high (≥ 50%)', detail: '≈ full sibs / parent–offspring or closer' };
}

function interpretRelationship(R) {
  if (R >= 0.5) return 'Parent–offspring or full siblings (≈50%+)';
  if (R >= 0.25) return 'Half-siblings, grandparent–grandchild, or uncle/aunt–niece/nephew (≈25%)';
  if (R >= 0.125) return 'First cousins or equivalent (≈12.5%)';
  if (R >= 0.0625) return 'First cousins once removed / second cousins range (≈6.25%)';
  if (R > 0.01) return 'Distantly related';
  return 'Essentially unrelated';
}

/**
 * Pedigree completeness statistics.
 */
function completenessStats(graph) {
  let total = 0, both = 0, one = 0, none = 0;
  const byClass = {};

  for (const node of graph.byId.values()) {
    total++;
    const hasM = node.mother_id != null;
    const hasF = node.father_id != null;
    if (hasM && hasF) both++;
    else if (hasM || hasF) one++;
    else none++;

    const cls = node.acquisition_class || 'Unknown';
    if (!byClass[cls]) byClass[cls] = { total: 0, both: 0, one: 0, none: 0 };
    byClass[cls].total++;
    if (hasM && hasF) byClass[cls].both++;
    else if (hasM || hasF) byClass[cls].one++;
    else byClass[cls].none++;
  }

  return {
    total,
    both_parents: both,
    one_parent: one,
    no_parents: none,
    pct_complete: total ? +(100 * both / total).toFixed(1) : 0,
    by_acquisition_class: byClass,
  };
}

/**
 * Return CoI for every animal (for CSV export or high-CoI table).
 */
function allCoi(graph, { threshold = 0, liveOnly = false } = {}) {
  const rows = [];
  for (const node of graph.byId.values()) {
    if (liveOnly && (node.dead === '1' || node.dead === 1 || node.distributed)) continue;
    const F = inbreedingCoefficient(graph, node.id);
    if (F >= threshold) {
      rows.push({
        id: node.id,
        animal_id: node.animal_id,
        name: node.name,
        sex: node.sex,
        birth_date: node.birth_date,
        mother_id: node.mother_id,
        father_id: node.father_id,
        coi: +F.toFixed(6),
        coi_pct: +(F * 100).toFixed(2),
        interpretation: interpretCoi(F).label,
        acquisition_class: node.acquisition_class,
      });
    }
  }
  rows.sort((a, b) => b.coi - a.coi);
  return rows;
}

module.exports = {
  buildPedigree,
  clearCaches,
  coancestry,
  inbreedingCoefficient,
  relationshipCoefficient,
  interpretCoi,
  interpretRelationship,
  completenessStats,
  allCoi,
};
