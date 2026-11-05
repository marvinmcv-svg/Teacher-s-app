"use client";
/** Minimal IndexedDB wrapper for the capture queue (no dependency). */
const DB_NAME = "tinta-capture";
const VERSION = 1;

export type QueuedGroup = {
  clientRef: string; // primary key; also the submission's idempotency key
  assignmentId: string;
  studentId: string | null;
  studentName: string | null;
  replaceExisting: boolean;
  status: "capturing" | "ready" | "uploading" | "done" | "error";
  submissionId?: string;
  pagePaths?: string[];
  error?: string;
  createdAt: number;
};
export type QueuedPage = {
  key: string; // `${clientRef}:${position}`
  clientRef: string;
  position: number;
  blob: Blob;
  width: number;
  height: number;
  quality: { sharpness: number; brightness: number; glare: number; issues: string[] } | null;
  override: boolean;
  uploaded: boolean;
};

let dbPromise: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("groups")) db.createObjectStore("groups", { keyPath: "clientRef" });
      if (!db.objectStoreNames.contains("pages"))
        db.createObjectStore("pages", { keyPath: "key" }).createIndex("byGroup", "clientRef");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  store: "groups" | "pages",
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const r = fn(t.objectStore(store));
        t.oncomplete = () => resolve(r ? (r as IDBRequest<T>).result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export const queueDb = {
  putGroup: (g: QueuedGroup) => tx("groups", "readwrite", (s) => s.put(g)),
  getGroup: (ref: string) => tx<QueuedGroup>("groups", "readonly", (s) => s.get(ref)),
  allGroups: async () =>
    ((await tx<QueuedGroup[]>("groups", "readonly", (s) => s.getAll())) ?? []).sort(
      (a, b) => a.createdAt - b.createdAt,
    ),
  deleteGroup: (ref: string) => tx("groups", "readwrite", (s) => s.delete(ref)),
  putPage: (p: QueuedPage) => tx("pages", "readwrite", (s) => s.put(p)),
  pagesOf: async (ref: string) =>
    ((await tx<QueuedPage[]>("pages", "readonly", (s) => s.index("byGroup").getAll(ref))) ?? []).sort(
      (a, b) => a.position - b.position,
    ),
  deletePagesOf: async (ref: string) => {
    const pages = await queueDb.pagesOf(ref);
    await Promise.all(pages.map((p) => tx("pages", "readwrite", (s) => s.delete(p.key))));
  },
};
