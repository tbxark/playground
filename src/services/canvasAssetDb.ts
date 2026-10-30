import {
  CANVAS_ASSET_STORE,
  CanvasAssetRecord,
  getDb,
} from "./historyDb";

/**
 * Free-canvas local assets live in the same IndexedDB database as the gallery
 * (one connection, one upgrade path). Only non-gallery files are duplicated
 * here: uploads, unsaved results and committed main-image edits.
 */
export async function putCanvasAsset(key: string, blob: Blob): Promise<void> {
  const db = await getDb();
  const record: CanvasAssetRecord = { key, blob, createdAt: Date.now() };
  await db.put(CANVAS_ASSET_STORE, record);
}

export async function getCanvasAsset(key: string): Promise<Blob | undefined> {
  const db = await getDb();
  const record = await db.get(CANVAS_ASSET_STORE, key);
  return record?.blob;
}

export async function deleteCanvasAsset(key: string): Promise<void> {
  const db = await getDb();
  await db.delete(CANVAS_ASSET_STORE, key);
}

export async function listCanvasAssetKeys(): Promise<string[]> {
  const db = await getDb();
  return db.getAllKeys(CANVAS_ASSET_STORE);
}

/** Assets the free canvas owns. The workflow store owns `workflow-` keys. */
export const CANVAS_ASSET_PREFIXES = ["card-", "simple-"];

/**
 * Remove assets that no persisted card points at and that are older than the
 * grace period.
 *
 * Runs on startup after hydration. The age grace avoids deleting an asset
 * another open tab just wrote before its card list reached localStorage, and
 * an asset a back/forward-cached page (or an open viewer) may still need.
 * `maxCount` is kept for callers but deliberately does not evict inside the
 * grace window: cross-tab references cannot be proven absent from this tab.
 *
 * `prefixes` scopes the sweep to the caller's own keys: the free canvas and the
 * workflow share this store, and a canvas sweep must never delete a workflow
 * image that a node still references.
 */
export async function pruneCanvasAssets(
  validKeys: string[],
  maxAgeMs = 3 * 24 * 60 * 60 * 1000,
  maxCount = 150,
  prefixes: string[] = CANVAS_ASSET_PREFIXES
): Promise<number> {
  const valid = new Set(validKeys);
  const db = await getDb();
  const cutoff = Date.now() - maxAgeMs;
  const readTx = db.transaction(CANVAS_ASSET_STORE, "readonly");
  const records = await readTx.store.getAll();
  await readTx.done;

  const owned = records.filter((record) =>
    prefixes.some((prefix) => record.key.startsWith(prefix))
  );

  const orphans: string[] = [];

  for (const record of owned) {
    if (valid.has(record.key)) continue;
    if (record.createdAt < cutoff) {
      orphans.push(record.key);
    }
  }

  // A count cap used to evict un-referenced assets even inside the grace
  // window. That silently deleted blobs another tab (whose card list had not
  // reached localStorage yet) or a back/forward-cached page still referenced.
  // Only age-eligible orphans are reclaimed now; `maxCount` remains in the
  // signature for callers but no longer overrides the grace period.
  void maxCount;

  if (orphans.length === 0) return 0;
  const tx = db.transaction(CANVAS_ASSET_STORE, "readwrite");
  await Promise.all(orphans.map((key) => tx.store.delete(key)));
  await tx.done;
  return orphans.length;
}

/**
 * Delete one card's asset immediately. Called when a card is removed: waiting
 * for the startup prune keeps every deleted upload/result blob alive for the
 * rest of the session.
 */
export async function deleteCanvasAssetIfUnreferenced(
  key: string | undefined,
  validKeys: string[]
): Promise<void> {
  if (!key) return;
  if (validKeys.includes(key)) return;
  try {
    await deleteCanvasAsset(key);
  } catch {
    // A failed cleanup must never break card removal; the startup prune retries.
  }
}
