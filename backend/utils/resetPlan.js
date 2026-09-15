/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Which KEPT tables a `TRUNCATE … CASCADE` of the wiped tables would empty
 * anyway — and how to put them back.
 *
 * `TRUNCATE … CASCADE` follows foreign-key DEFINITIONS, not data. It empties
 * every table with a foreign key into a truncated table, whatever the rows
 * contain and whatever the ON DELETE rule says. `platform_settings.updated_by`
 * references `profiles`, so wiping the people also wiped the settings the reset
 * script promised to keep — currencies and fee defaults, without which no event
 * can be created in any country.
 *
 * Given the foreign keys (read from pg_constraint by the script), this returns:
 *
 *   cascaded      kept tables CASCADE would empty (directly or through another)
 *   restoreOrder  how to put them back: each with the columns that pointed at
 *                 wiped rows and must be set to NULL, parents before children
 *   blocked       such columns that are NOT NULL — those rows cannot be kept
 *                 without inventing a reference, so the reset must refuse
 *   unresolved    kept tables whose restore order could not be decided
 *
 * Pure, so it is unit-tested without a database.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function planKeep({ wipe, keep, foreignKeys }) {
  const wiped = new Set(wipe);
  const kept = new Set(keep);

  // Everything CASCADE reaches: the wiped tables, then anything referencing an
  // emptied table, until nothing new is added.
  const emptied = new Set(wipe);
  for (let grew = true; grew;) {
    grew = false;
    for (const fk of foreignKeys) {
      if (emptied.has(fk.references) && !emptied.has(fk.table)) {
        emptied.add(fk.table);
        grew = true;
      }
    }
  }

  const cascaded = keep.filter((t) => emptied.has(t));
  const cascadedSet = new Set(cascaded);

  const plans = cascaded.map((table) => {
    const own = foreignKeys.filter((fk) => fk.table === table);
    // A reference to a kept table that is restored too stays valid; anything
    // else that CASCADE empties is gone and must be cleared.
    const dangling = own.filter((fk) => fk.references !== table
      && (wiped.has(fk.references) || (emptied.has(fk.references) && !kept.has(fk.references))));
    return {
      table,
      nullColumns: [...new Set(dangling.map((fk) => fk.column))],
      blocked: dangling.filter((fk) => fk.notNull).map((fk) => `${table}.${fk.column} → ${fk.references}`),
      dependsOn: [...new Set(own
        .filter((fk) => fk.references !== table && cascadedSet.has(fk.references))
        .map((fk) => fk.references))],
    };
  });

  const restoreOrder = [];
  const placed = new Set();
  for (let progressed = true; progressed && restoreOrder.length < plans.length;) {
    progressed = false;
    for (const plan of plans) {
      if (!placed.has(plan.table) && plan.dependsOn.every((d) => placed.has(d))) {
        restoreOrder.push({ table: plan.table, nullColumns: plan.nullColumns });
        placed.add(plan.table);
        progressed = true;
      }
    }
  }

  return {
    cascaded,
    restoreOrder,
    blocked: plans.flatMap((p) => p.blocked),
    unresolved: plans.filter((p) => !placed.has(p.table)).map((p) => p.table),
  };
}

module.exports = { planKeep };
