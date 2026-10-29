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
 * Remove assets that no persisted card points at.
 *
 * Runs on startup after hydration and whenever a card owning an asset is
 * deleted. The age grace avoids deleting an asset another open tab just wrote
 * before its card list reached localStorage; `maxCount` additionally caps the
 * store so a long session cannot grow it until the shared origin quota is full
 * (which would also break gallery writes).
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
  let kept = owned.length;
  const stale: typeof records = [];

  for (const record of owned) {
    if (valid.has(record.key)) continue;
    if (record.createdAt < cutoff) {
      orphans.push(record.key);
      kept -= 1;
    } else {
      stale.push(record);
    }
  }

  // Still above the cap: evict the oldest unreferenced assets, even inside the
  // grace window. Referenced assets are never touched here.
  if (kept > maxCount) {
    stale.sort((a, b) => a.createdAt - b.createdAt);
    const excess = kept - maxCount;
    for (const record of stale.slice(0, excess)) {
      orphans.push(record.key);
    }
  }

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
