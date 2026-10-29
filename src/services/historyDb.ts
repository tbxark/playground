import { DBSchema, IDBPDatabase, openDB } from "idb";
import JSZip from "jszip";
import { toast } from "sonner";
import { HistoryRecord } from "./types";
import { i18n } from "@/i18n";

export type CanvasAssetRecord = {
  key: string;
  blob: Blob;
  createdAt: number;
};

interface PlaygroundDBSchema extends DBSchema {
  gallery: {
    key: number;
    value: HistoryRecord;
    indexes: {
      "by-createdAt": number;
      "by-nanoid": string;
      "by-starred": number; // 1 for true, 0 for false
    };
  };
  canvasAssets: {
    key: string;
    value: CanvasAssetRecord;
  };
}

const DB_NAME = "universal-playground-db";
export const DB_VERSION = 2;
const STORE_NAME = "gallery";
export const CANVAS_ASSET_STORE = "canvasAssets";

let dbPromise: Promise<IDBPDatabase<PlaygroundDBSchema>> | null = null;

/**
 * Close and forget the cached connection. Used by the `blocking` /
 * `versionchange` handlers and by retry paths: a closed IDBPDatabase must never
 * be handed out again, or every later write throws InvalidStateError.
 */
export function resetDbConnection(): void {
  dbPromise = null;
}

function createDatabase(): Promise<IDBPDatabase<PlaygroundDBSchema>> {
  return openDB<PlaygroundDBSchema>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, {
            keyPath: "id",
            autoIncrement: true,
          });
          store.createIndex("by-createdAt", "createdAt");
          store.createIndex("by-nanoid", "nanoid", { unique: true });
          store.createIndex("by-starred", "starred");
        }
      }
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(CANVAS_ASSET_STORE)) {
          db.createObjectStore(CANVAS_ASSET_STORE, { keyPath: "key" });
        }
      }
    },
    blocked() {
      toast.error(i18n.t("err.dbBlocked"), {
        id: "db-blocked",
        duration: Infinity,
        description: i18n.t("err.dbBlockedDesc"),
      });
    },
    blocking() {
      // Another tab needs an upgrade: close our connection, forget the cached
      // promise and ask for a refresh so we never hand out a closed DB.
      const pending = dbPromise;
      resetDbConnection();
      if (pending) {
        void pending
          .then((db) => db.close())
          .catch(() => undefined);
      }
      toast.warning(i18n.t("err.dbVersionChange"), {
        id: "db-version-change",
        duration: Infinity,
        description: i18n.t("err.dbVersionChangeDesc"),
        action: {
          label: i18n.t("common.refresh"),
          onClick: () => window.location.reload(),
        },
      });
    },
    terminated() {
      resetDbConnection();
      toast.error(i18n.t("err.dbClosed"), {
        id: "db-terminated",
        duration: Infinity,
      });
    },
  }).then((db) => {
    db.onversionchange = () => {
      db.close();
      resetDbConnection();
    };
    toast.dismiss("db-blocked");
    toast.dismiss("db-version-change");
    toast.dismiss("db-terminated");
    return db;
  });
}

const DB_OPEN_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(i18n.t("err.dbOpenTimeout"))),
      ms
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function getDb(): Promise<IDBPDatabase<PlaygroundDBSchema>> {
  if (!dbPromise) {
    const opening = createDatabase();
    // `openDB` never settles while another tab blocks the upgrade, and every
    // caller awaits this without a deadline: a queue task would sit in
    // "submitting" forever holding a concurrency slot. Fail fast so callers can
    // retry; if the open succeeds later, close it instead of leaking a
    // connection that keeps the other tab blocked.
    dbPromise = withTimeout(opening, DB_OPEN_TIMEOUT_MS).catch((error) => {
      dbPromise = null;
      void opening.then((db) => db.close()).catch(() => undefined);
      throw error;
    });
  }
  return dbPromise;
}

export async function saveToHistory(
  record: Omit<HistoryRecord, "id">,
  maxCount = 200
): Promise<number> {
  const db = await getDb();
  const existing = await db.getFromIndex(STORE_NAME, "by-nanoid", record.nanoid);
  const id = existing
    ? (await db.put(STORE_NAME, { ...record, id: existing.id } as HistoryRecord), existing.id)
    : await db.add(STORE_NAME, record as HistoryRecord);
  // Manual saves reuse the original generation time, so the row just written
  // can be the oldest one. Never let the trim delete the record we are about to
  // report as saved — the caller drops its canvas copy once it sees "saved".
  await trimHistory(maxCount, id);
  return id;
}

export async function listHistory(filter?: {
  search?: string;
  starredOnly?: boolean;
  model?: string;
  limit?: number;
}): Promise<HistoryRecord[]> {
  const db = await getDb();
  let records = await db.getAllFromIndex(STORE_NAME, "by-createdAt");
  records = records.reverse(); // newest first

  if (filter?.starredOnly) {
    records = records.filter((r) => r.starred);
  }

  if (filter?.model && filter.model !== "all") {
    records = records.filter((r) => r.model === filter.model);
  }

  if (filter?.search?.trim()) {
    const query = filter.search.toLowerCase();
    const nanoidMatch = query.match(/^[a-z0-9_-]+$/i)?.[0];
    records = records.filter(
      (r) =>
        (r.prompt || "").toLowerCase().includes(query) ||
        (r.model || "").toLowerCase().includes(query) ||
        (r.provider || "").toLowerCase().includes(query) ||
        Boolean(nanoidMatch && (r.nanoid || "").toLowerCase().includes(nanoidMatch))
    );
  }

  if (filter?.limit && filter.limit > 0) {
    records = records.slice(0, filter.limit);
  }

  return records;
}

export async function listHistoryModels(): Promise<string[]> {
  const db = await getDb();
  const records = await db.getAll(STORE_NAME);
  return Array.from(new Set(records.map((record) => record.model).filter(Boolean))).sort();
}

export async function getHistoryRecordByNanoid(
  nanoid: string
): Promise<HistoryRecord | undefined> {
  const db = await getDb();
  return db.getFromIndex(STORE_NAME, "by-nanoid", nanoid);
}

export async function getHistoryRecord(
  id: number
): Promise<HistoryRecord | undefined> {
  const db = await getDb();
  return db.get(STORE_NAME, id);
}

export async function deleteHistoryRecord(id: number): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_NAME, id);
}

export async function toggleStar(id: number): Promise<boolean> {
  const db = await getDb();
  const record = await db.get(STORE_NAME, id);
  if (!record) return false;

  const nextState = !record.starred;
  record.starred = nextState;
  await db.put(STORE_NAME, record);
  return nextState;
}

export async function clearHistory(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE_NAME);
}

export async function trimHistory(
  maxCount = 200,
  keepId?: number
): Promise<number> {
  if (maxCount <= 0) return 0;
  const db = await getDb();
  const total = await db.count(STORE_NAME);
  if (total <= maxCount) return 0;

  const toRemoveCount = total - maxCount;
  const tx = db.transaction(STORE_NAME, "readwrite");
  const index = tx.store.index("by-createdAt");
  let removed = 0;

  for await (const cursor of index.iterate(null, "next")) {
    if (removed >= toRemoveCount) break;
    if (keepId !== undefined && cursor.primaryKey === keepId) continue;
    // Don't auto delete starred records
    if (!cursor.value.starred) {
      await cursor.delete();
      removed++;
    }
  }

  await tx.done;
  return removed;
}

export async function exportHistoryAsZip(): Promise<Blob> {
  const db = await getDb();

  const zip = new JSZip();
  const manifest: Array<Record<string, unknown>> = [];

  // Iterate instead of `getAll()`: the gallery can hold hundreds of 4K blobs,
  // and materialising every record first doubles peak memory before JSZip even
  // starts. PNG payloads are already compressed, so STORE avoids a second
  // full-size deflate copy.
  const readTx = db.transaction(STORE_NAME, "readonly");
  let index = 0;
  for await (const cursor of readTx.store) {
    const record = cursor.value;
    index += 1;
    const filename = `image_${index}_${record.nanoid}.png`;
    zip.file(filename, record.imageBlob);

    manifest.push({
      filename,
      nanoid: record.nanoid,
      prompt: record.prompt,
      negativePrompt: record.negativePrompt,
      provider: record.provider,
      model: record.model,
      size: record.size,
      resolution: record.resolution,
      seed: record.seed,
      cfgScale: record.cfgScale,
      steps: record.steps,
      createdAt: new Date(record.createdAt).toISOString(),
      generationTimeMs: record.generationTimeMs,
    });
  }
  await readTx.done;

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  return zip.generateAsync({ type: "blob", compression: "STORE" });
}
