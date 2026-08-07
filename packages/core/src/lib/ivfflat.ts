/**
 * ivfflat index sizing.
 *
 * An ivfflat index partitions the vectors into `lists` clusters and a search
 * visits `ivfflat.probes` of them. Both numbers only make sense relative to
 * the row count: the schema shipped `lists = 100` against a vault of ~800
 * rows, which put ~8 rows in each cluster, and with pgvector's default
 * `probes = 1` a semantic search could reach ~1% of the vault. Nothing failed
 * — the search simply returned the best of eleven rows and called it the best
 * of eight hundred.
 *
 * The two settings are fixed together because fixing either alone is not
 * enough: a right-sized `lists` still only probes one cluster, and more probes
 * over a badly sized index just walks a bad partitioning.
 */

/** pgvector's upper bound for the `lists` build option. */
const MAX_LISTS = 32768;

/** pgvector's default when an ivfflat index is created without `WITH (lists=...)`. */
const DEFAULT_LISTS = 100;

/**
 * How far the live `lists` may drift from the ideal before the index is
 * rebuilt. Rebuilding takes an ACCESS EXCLUSIVE lock, and `lists` is derived
 * from the row count, so without a band a growing vault would rebuild on every
 * boot. A factor of two means the vault has to double (or halve) to trigger
 * one, while recall within that band stays intact because `probes` is derived
 * from the *live* `lists`, not the ideal one.
 */
const RESIZE_FACTOR = 2;

const LISTS_OPTION = /\blists\s*=\s*'?(\d+)'?/i;

/** pgvector's sizing rule: `lists ≈ rows/1000` for datasets up to 1M rows. */
export function targetLists(rows: number): number {
  return Math.min(Math.max(Math.round(rows / 1000), 1), MAX_LISTS);
}

export function probesFor(lists: number): number {
  return Math.ceil(Math.sqrt(lists));
}

export function needsResize(current: number, target: number): boolean {
  return current / target >= RESIZE_FACTOR || target / current >= RESIZE_FACTOR;
}

export function parseLists(indexdef: string): number {
  const match = LISTS_OPTION.exec(indexdef);
  return match ? parseInt(match[1], 10) : DEFAULT_LISTS;
}

/**
 * Rewrite a `CREATE INDEX` statement taken from `pg_indexes.indexdef` with a
 * new `lists` value. Reusing the catalog's own definition keeps the opclass,
 * column and schema exactly as they were — this must not silently turn a
 * `vector_l2_ops` index into a cosine one. The append branch assumes no
 * trailing `WHERE` / `TABLESPACE` clause, which holds for every ivfflat index
 * this project creates (`lists` is the only reloption ivfflat accepts).
 */
export function rewriteLists(indexdef: string, lists: number): string {
  if (LISTS_OPTION.test(indexdef)) {
    return indexdef.replace(LISTS_OPTION, `lists = ${lists}`);
  }
  return `${indexdef} WITH (lists = ${lists})`;
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Store `probes` as the database-wide default, so every session that connects
 * from then on starts with it — the watcher and one-off scripts included,
 * whether or not they went through this package's pool.
 *
 * Set once at boot rather than per connection. The obvious alternative, a
 * `pool.on('connect')` hook issuing `SET`, races: node-postgres hands the
 * client to the borrower without waiting for the hook's query, so the two
 * overlap on one connection — pg warns about it today and drops the behavior
 * in pg@9. `SET LOCAL` per query was the other option, and it would require
 * wrapping every search in an explicit transaction.
 *
 * Requires ownership of the database (the installer's `createdb --owner`
 * gives the runtime role exactly that; a hand-provisioned database may not).
 * Both arguments come from the server: `database` from `current_database()`,
 * quoted as an identifier, and `probes` a clamped integer.
 */
export function setProbesSql(database: string, probes: number): string {
  return `ALTER DATABASE ${quoteIdent(database)} SET ivfflat.probes = ${Math.trunc(probes)}`;
}
