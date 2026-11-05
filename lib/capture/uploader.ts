"use client";
import { finishSubmission, startSubmission } from "@/lib/actions/capture";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { queueDb, type QueuedGroup } from "./idb";

/**
 * Background uploader for the capture queue (§3.2 "offline-tolerant").
 * Runs while the app is open: on load, on `online`, and when new work is
 * queued. Every step is idempotent so a dropped connection or closed tab
 * resumes where it left off. (Background Sync isn't reliable on iOS Safari,
 * so we don't depend on it — the UI says uploads resume when Tinta is open.)
 */
type Listener = () => void;
const listeners = new Set<Listener>();
let snapshot: QueuedGroup[] = [];
let running = false;
let rerun = false;

async function refresh() {
  snapshot = await queueDb.allGroups();
  listeners.forEach((l) => l());
}

export const uploadQueue = {
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  getSnapshot: () => snapshot,
  getServerSnapshot: () => [] as QueuedGroup[],
  refresh,
  kick,
};

function online() {
  return typeof navigator === "undefined" || navigator.onLine;
}

export async function kick() {
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  try {
    do {
      rerun = false;
      const groups = await queueDb.allGroups();
      for (const g of groups) {
        if (!online()) break;
        if (g.status === "ready" || g.status === "uploading" || g.status === "error") await uploadGroup(g);
      }
      await refresh();
    } while (rerun && online());
  } finally {
    running = false;
  }
}

async function uploadGroup(g: QueuedGroup) {
  const pages = await queueDb.pagesOf(g.clientRef);
  if (!pages.length) {
    await queueDb.deleteGroup(g.clientRef);
    return;
  }
  try {
    await queueDb.putGroup({ ...g, status: "uploading", error: undefined });
    await refresh();
    let { submissionId, pagePaths } = g;
    if (!submissionId || !pagePaths || pagePaths.length !== pages.length) {
      const res = await startSubmission({
        assignmentId: g.assignmentId,
        clientRef: g.clientRef,
        studentId: g.studentId,
        pageCount: pages.length,
        replaceExisting: g.replaceExisting,
      });
      if (!res.ok) throw new UploadError(res.error);
      submissionId = res.submissionId;
      pagePaths = res.pagePaths;
      await queueDb.putGroup({ ...g, status: "uploading", submissionId, pagePaths });
    }
    const supabase = createSupabaseBrowserClient();
    for (const [i, page] of pages.entries()) {
      if (page.uploaded) continue;
      const { error } = await supabase.storage
        .from("pages-original")
        .upload(pagePaths[i], page.blob, { contentType: "image/jpeg", upsert: false });
      // "already exists" = uploaded on a previous attempt
      if (error && !/exists|duplicate/i.test(error.message)) throw new UploadError("upload_failed");
      await queueDb.putPage({ ...page, uploaded: true });
    }
    const done = await finishSubmission({
      submissionId,
      pages: pages.map((p, i) => ({
        position: p.position,
        path: pagePaths![i],
        quality: p.quality,
        override: p.override,
      })),
    });
    if (!done.ok) throw new UploadError("finish_failed");
    await queueDb.deletePagesOf(g.clientRef); // free the device: blobs are now safely stored
    await queueDb.putGroup({ ...g, submissionId, pagePaths, status: "done" });
  } catch (err) {
    const code = err instanceof UploadError ? err.code : "network";
    await queueDb.putGroup({ ...(await queueDb.getGroup(g.clientRef))!, status: "error", error: code });
  }
}

class UploadError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

let started = false;
/** Call once on the client (scan screen and the teacher shell). */
export function startUploader() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("online", () => void kick());
  setInterval(() => void kick(), 30_000); // retry errors with a gentle cadence
  void kick();
}
