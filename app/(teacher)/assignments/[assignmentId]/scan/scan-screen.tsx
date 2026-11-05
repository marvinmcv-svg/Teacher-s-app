"use client";
import {
  ArrowLeft,
  Camera,
  FileText,
  QrCode,
  Check,
  ChevronRight,
  CloudOff,
  ImageUp,
  RotateCcw,
  Search,
  Trash2,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { preparePdfImport, startPdfImport } from "@/lib/actions/capture";
import { analyse, decodeFile, frameDiff, readQr, toJpeg } from "@/lib/capture/camera";
import { queueDb, type QueuedGroup, type QueuedPage } from "@/lib/capture/idb";
import { kick, startUploader, uploadQueue } from "@/lib/capture/uploader";
import type { QualityIssue } from "@/lib/image/quality";
import { splitByQr, type PageQr } from "@/lib/qr/payload";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Student = { id: string; display_name: string; qr_code_token: string };
type LocalPage = { position: number; url: string; issues: QualityIssue[]; override: boolean };
type Current = {
  clientRef: string;
  studentId: string | null;
  studentName: string | null;
  replace: boolean;
  pages: LocalPage[];
};
type Pending = {
  blob: Blob;
  width: number;
  height: number;
  url: string;
  issues: QualityIssue[];
  quality: QueuedPage["quality"];
};

const newRef = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/-/g, "");

function useOnline() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

export function ScanScreen({
  assignment,
  roster,
  scannedIds,
}: {
  assignment: { id: string; title: string };
  roster: Student[];
  scannedIds: string[];
}) {
  const t = useTranslations("scan");
  const router = useRouter();
  const online = useOnline();
  const groups = useSyncExternalStore(uploadQueue.subscribe, uploadQueue.getSnapshot, uploadQueue.getServerSnapshot);
  const mine = groups.filter((g) => g.assignmentId === assignment.id);
  const [current, setCurrent] = useState<Current | null>(null);
  const [picking, setPicking] = useState(true);
  const [pending, setPending] = useState<Pending | null>(null);
  const [cameraError, setCameraError] = useState(false);
  const [auto, setAuto] = useState(true);
  const [hint, setHint] = useState<QualityIssue | "steady" | null>(null);
  const [qrNote, setQrNote] = useState<string | null>(null);
  const currentRef = useRef<Current | null>(null);
  currentRef.current = current;
  useEffect(() => {
    if (!qrNote) return;
    const id = setTimeout(() => setQrNote(null), 2500);
    return () => clearTimeout(id);
  }, [qrNote]);
  const byToken = useMemo(() => new Map(roster.map((s) => [s.qr_code_token, s])), [roster]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastFrame = useRef<Uint8Array | null>(null);
  const steadyCount = useRef(0);
  const armed = useRef(true);

  const scanned = useMemo(
    () => new Set([...scannedIds, ...mine.map((g) => g.studentId).filter(Boolean)] as string[]),
    [scannedIds, mine],
  );

  // Resume: anything left mid-capture from a closed tab is queued as-is; start the uploader.
  useEffect(() => {
    (async () => {
      for (const g of await queueDb.allGroups()) {
        if (g.status === "capturing") await queueDb.putGroup({ ...g, status: "ready" });
        // finished uploads only need to stay visible for a while
        else if (g.status === "done" && Date.now() - g.createdAt > 12 * 3600_000)
          await queueDb.deleteGroup(g.clientRef);
      }
      startUploader();
      await uploadQueue.refresh();
      void kick();
    })();
  }, []);

  // Camera
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } },
          audio: false,
        });
        if (cancelled) return stream.getTracks().forEach((tr) => tr.stop());
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        setCameraError(true);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  const startGroup = useCallback(
    async (student: Student | null, replace = false) => {
      const g: QueuedGroup = {
        clientRef: newRef(),
        assignmentId: assignment.id,
        studentId: student?.id ?? null,
        studentName: student?.display_name ?? null,
        replaceExisting: replace,
        status: "capturing",
        createdAt: Date.now(),
      };
      await queueDb.putGroup(g);
      const next = { clientRef: g.clientRef, studentId: g.studentId, studentName: g.studentName, replace, pages: [] };
      currentRef.current = next;
      setCurrent(next);
      setPicking(false);
    },
    [assignment.id],
  );

  const addPage = useCallback(async (p: Pending, override: boolean) => {
    const current = currentRef.current;
    if (!current) return;
    const position = current.pages.length + 1;
    currentRef.current = {
      ...current,
      pages: [...current.pages, { position, url: p.url, issues: p.issues, override }],
    };
    await queueDb.putPage({
      key: `${current.clientRef}:${position}`,
      clientRef: current.clientRef,
      position,
      blob: p.blob,
      width: p.width,
      height: p.height,
      quality: p.quality,
      override,
      uploaded: false,
    });
    setCurrent((c) => c && { ...c, pages: [...c.pages, { position, url: p.url, issues: p.issues, override }] });
    setPending(null);
  }, []);

  const capture = useCallback(async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || !current || pending) return;
    const { metrics, issues } = analyse(v, v.videoWidth, v.videoHeight, Math.max(v.videoWidth, v.videoHeight));
    const qr = readQr(v, v.videoWidth, v.videoHeight);
    const qrStudent = qr ? byToken.get(qr.token) : undefined;
    if (qr && qrStudent && qr.kind === "cover") {
      // Cover sheet (§3.2): it names the next student and is not itself a page of work.
      navigator.vibrate?.([20, 40, 20]);
      await commitCurrent();
      await startGroup(qrStudent, scanned.has(qrStudent.id));
      setQrNote(t("qrMatched", { name: qrStudent.display_name }));
      return;
    }
    if (qr && qrStudent && qr.kind === "sticker" && currentRef.current?.studentId !== qrStudent.id) {
      const cur = currentRef.current!;
      if (!cur.studentId && cur.pages.length === 0) {
        // Sticker on the first page: this capture is that student's.
        const g = (await queueDb.getGroup(cur.clientRef))!;
        const replace = scanned.has(qrStudent.id);
        await queueDb.putGroup({
          ...g,
          studentId: qrStudent.id,
          studentName: qrStudent.display_name,
          replaceExisting: replace,
        });
        const next = { ...cur, studentId: qrStudent.id, studentName: qrStudent.display_name, replace };
        currentRef.current = next;
        setCurrent(next);
      } else {
        await commitCurrent();
        await startGroup(qrStudent, scanned.has(qrStudent.id));
      }
      setQrNote(t("qrMatched", { name: qrStudent.display_name }));
    }
    const jpeg = await toJpeg(v, v.videoWidth, v.videoHeight);
    const p: Pending = {
      ...jpeg,
      url: URL.createObjectURL(jpeg.blob),
      issues,
      quality: { sharpness: metrics.sharpness, brightness: metrics.brightness, glare: metrics.glare, issues },
    };
    navigator.vibrate?.(30);
    if (issues.length) setPending(p);
    else await addPage(p, false);
  }, [current, pending, addPage, byToken, startGroup, scanned, t]);

  // Live quality hints + steady-hand auto-capture
  useEffect(() => {
    if (!current || picking || cameraError) return;
    const id = setInterval(() => {
      const v = videoRef.current;
      if (!v || !v.videoWidth || pending) return;
      const { issues, gray } = analyse(v, v.videoWidth, v.videoHeight, Math.max(v.videoWidth, v.videoHeight));
      const diff = frameDiff(lastFrame.current, gray);
      lastFrame.current = gray;
      if (issues.length) {
        steadyCount.current = 0;
        setHint(issues[0]);
        return;
      }
      if (diff > 6) {
        steadyCount.current = 0;
        armed.current = true; // moved: ready for the next page
        setHint(null);
        return;
      }
      steadyCount.current++;
      setHint(auto && armed.current ? "steady" : null);
      if (auto && armed.current && steadyCount.current >= 3) {
        armed.current = false;
        steadyCount.current = 0;
        void capture();
      }
    }, 350);
    return () => clearInterval(id);
  }, [current, picking, cameraError, pending, auto, capture]);

  async function commitCurrent() {
    const current = currentRef.current;
    if (!current) return;
    if (current.pages.length === 0) await queueDb.deleteGroup(current.clientRef);
    else await queueDb.putGroup({ ...(await queueDb.getGroup(current.clientRef))!, status: "ready" });
    current.pages.forEach((p) => URL.revokeObjectURL(p.url));
    currentRef.current = null;
    setCurrent(null);
    await uploadQueue.refresh();
    void kick();
  }

  async function removePage(position: number) {
    if (!current) return;
    // rewrite remaining pages with consecutive positions
    const pages = (await queueDb.pagesOf(current.clientRef)).filter((p) => p.position !== position);
    await queueDb.deletePagesOf(current.clientRef);
    const kept: LocalPage[] = [];
    for (const [i, p] of pages.entries()) {
      await queueDb.putPage({ ...p, position: i + 1, key: `${current.clientRef}:${i + 1}` });
      const old = current.pages.find((x) => x.position === p.position)!;
      kept.push({ ...old, position: i + 1 });
    }
    URL.revokeObjectURL(current.pages.find((x) => x.position === position)?.url ?? "");
    setCurrent({ ...current, pages: kept });
  }

  async function bulkUpload(files: FileList, perStudent: number) {
    const list = Array.from(files).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    // Pass 1: encode every photo and read any QR (cover sheet / name sticker).
    const encoded: { jpeg: Awaited<ReturnType<typeof toJpeg>>; quality: QueuedPage["quality"] }[] = [];
    const qrs: PageQr[] = [];
    for (const f of list) {
      const bmp = await decodeFile(f);
      const { metrics, issues } = analyse(bmp, bmp.width, bmp.height, Math.max(bmp.width, bmp.height));
      const qr = readQr(bmp, bmp.width, bmp.height);
      const jpeg = await toJpeg(bmp, bmp.width, bmp.height);
      bmp.close();
      encoded.push({
        jpeg,
        quality: { sharpness: metrics.sharpness, brightness: metrics.brightness, glare: metrics.glare, issues },
      });
      qrs.push(qr && byToken.has(qr.token) ? { kind: qr.kind, token: qr.token } : null);
    }
    // Pass 2: group by QR when present, else by the fixed pages-per-student count.
    const taken = new Set(scanned);
    for (const [gi, g] of splitByQr(qrs, perStudent).entries()) {
      const clientRef = newRef();
      let student = g.token ? (byToken.get(g.token) ?? null) : null;
      if (student && taken.has(student.id)) student = null; // already has work: the teacher decides
      if (student) taken.add(student.id);
      await queueDb.putGroup({
        clientRef,
        assignmentId: assignment.id,
        studentId: student?.id ?? null,
        studentName: student?.display_name ?? null,
        replaceExisting: false,
        status: "capturing",
        createdAt: Date.now() + gi,
      });
      for (const [j, idx] of g.pages.entries()) {
        await queueDb.putPage({
          key: `${clientRef}:${j + 1}`,
          clientRef,
          position: j + 1,
          ...encoded[idx].jpeg,
          quality: encoded[idx].quality,
          override: false,
          uploaded: false,
        });
      }
      await queueDb.putGroup({ ...(await queueDb.getGroup(clientRef))!, status: "ready" });
    }
    await uploadQueue.refresh();
    void kick();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/assignments/${assignment.id}`}
          className="inline-flex min-h-11 items-center gap-1 text-sm text-ink-muted hover:text-ink"
        >
          <ArrowLeft aria-hidden className="size-4" /> {t("backToAssignment")}
        </Link>
        <span className="truncate text-sm text-ink-muted">{assignment.title}</span>
      </div>

      {!online && (
        <p role="status" className="flex items-start gap-2 rounded-xl border border-pen-amber/50 bg-card p-3 text-sm">
          <CloudOff aria-hidden className="mt-0.5 size-4 shrink-0 text-pen-amber" /> {t("offlineNote")}
        </p>
      )}

      {picking ? (
        <StudentPicker roster={roster} scanned={scanned} onPick={startGroup} />
      ) : (
        current && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={async () => (await commitCurrent(), setPicking(true))}
                className="inline-flex min-h-11 items-center gap-1 rounded-lg font-medium"
              >
                {current.studentName ?? t("unknownStudent")} <ChevronRight aria-hidden className="size-4" />
              </button>
              <span className="tabular text-sm text-ink-muted">{t("pages", { count: current.pages.length })}</span>
            </div>

            <div className="relative overflow-hidden rounded-[var(--radius-card)] border border-rule bg-black">
              {cameraError ? (
                <p className="p-6 text-paper">{t("cameraUnavailable")}</p>
              ) : (
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="aspect-[3/4] w-full object-cover"
                  aria-label={t("title")}
                />
              )}
              {/* framing guide */}
              {!cameraError && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-[6%] rounded-lg border-2 border-dashed border-white/70"
                />
              )}
              {hint && !pending && (
                <p
                  role="status"
                  className="absolute inset-x-3 top-3 rounded-lg bg-black/70 px-3 py-2 text-sm text-white"
                >
                  {hint === "steady" ? t("holdSteady") : t(`quality.${hint}`)}
                </p>
              )}
              {qrNote && !pending && (
                <p
                  role="status"
                  className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-lg bg-pen-green/90 px-3 py-2 text-sm text-white"
                >
                  <QrCode aria-hidden className="size-4" /> {qrNote}
                </p>
              )}
              {pending && (
                <div
                  role="alertdialog"
                  aria-label={t(`quality.${pending.issues[0]}`)}
                  className="absolute inset-0 flex flex-col justify-end gap-2 bg-black/60 p-3"
                >
                  <p className="rounded-lg bg-card p-3 text-sm text-ink">{t(`quality.${pending.issues[0]}`)}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      onClick={() => (URL.revokeObjectURL(pending.url), setPending(null), (armed.current = true))}
                    >
                      {t("retake")}
                    </Button>
                    <Button variant="ghost" className="bg-card" onClick={() => void addPage(pending, true)}>
                      {t("useAnyway")}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {current.pages.length > 0 && (
              <ol className="flex gap-2 overflow-x-auto pb-1" aria-label={t("pages", { count: current.pages.length })}>
                {current.pages.map((p) => (
                  <li key={p.position} className="relative shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                    <img
                      src={p.url}
                      alt={t("page", { n: p.position })}
                      className="h-20 w-16 rounded-md border border-rule object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => void removePage(p.position)}
                      aria-label={t("removePage", { n: p.position })}
                      className="absolute -right-2 -top-2 flex size-7 items-center justify-center rounded-full border border-rule bg-card"
                    >
                      <Trash2 aria-hidden className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ol>
            )}

            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <Button
                variant="outline"
                onClick={() => setAuto((a) => !a)}
                aria-pressed={auto}
                className={cn(auto && "border-pen-blue text-pen-blue")}
              >
                <Zap aria-hidden /> {t("autoCapture")}
              </Button>
              <button
                type="button"
                onClick={() => void capture()}
                disabled={cameraError || !!pending}
                aria-label={t("shutter")}
                className="flex size-18 items-center justify-center rounded-full border-4 border-ink bg-card disabled:opacity-40"
              >
                <Camera aria-hidden className="size-7" />
              </button>
              <Button onClick={async () => (await commitCurrent(), setPicking(true))} disabled={!current.pages.length}>
                {t("nextStudent")} <ChevronRight aria-hidden />
              </Button>
            </div>
            <Button
              variant="ghost"
              onClick={async () => (await commitCurrent(), router.push(`/assignments/${assignment.id}`))}
            >
              <Check aria-hidden /> {t("finish")}
            </Button>
          </div>
        )
      )}

      <BulkUpload onFiles={bulkUpload} />
      <PdfUpload assignmentId={assignment.id} online={online} />
      <QueuePanel groups={mine} />
    </div>
  );
}

function StudentPicker({
  roster,
  scanned,
  onPick,
}: {
  roster: Student[];
  scanned: Set<string>;
  onPick: (s: Student | null, replace?: boolean) => void;
}) {
  const t = useTranslations("scan");
  const [q, setQ] = useState("");
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
  const list = roster.filter((s) => norm(s.display_name).includes(norm(q)));
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h1 className="font-serif text-3xl">{t("pickStudent")}</h1>
      <div className="relative">
        <Search aria-hidden className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
        <Input
          aria-label={t("searchRoster")}
          placeholder={t("searchRoster")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-9"
          autoFocus
        />
      </div>
      <Button variant="outline" onClick={() => onPick(null)}>
        {t("unknownStudent")}
      </Button>
      <ul className="max-h-[50dvh] divide-y divide-rule overflow-y-auto" data-testid="roster-picker">
        {list.map((s) => {
          const done = scanned.has(s.id);
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onPick(s, done)}
                className="flex min-h-12 w-full items-center justify-between gap-2 px-1 text-left"
              >
                <span className={cn(done && "text-ink-muted")}>{s.display_name}</span>
                {done && (
                  <span className="text-xs text-ink-muted">
                    {t("alreadyScanned")} · {t("replace")}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function BulkUpload({ onFiles }: { onFiles: (f: FileList, perStudent: number) => Promise<void> }) {
  const t = useTranslations("scan");
  const [per, setPer] = useState(1);
  const [busy, setBusy] = useState(false);
  return (
    <details className="rounded-[var(--radius-card)] border border-rule bg-card p-4">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-medium">
        <ImageUp aria-hidden className="size-4" /> {t("uploadPhotos")}
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-sm text-ink-muted">{t("bulkHint")}</p>
        <div className="flex flex-col gap-1">
          <Label htmlFor="per">{t("pagesPerStudent")}</Label>
          <Select id="per" value={per} onChange={(e) => setPer(Number(e.target.value))} className="max-w-32">
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </div>
        <Input
          type="file"
          accept="image/*"
          multiple
          disabled={busy}
          aria-label={t("uploadPhotos")}
          className="py-2"
          onChange={async (e) => {
            if (!e.target.files?.length) return;
            setBusy(true);
            try {
              await onFiles(e.target.files, per);
            } finally {
              setBusy(false);
              e.target.value = "";
            }
          }}
        />
      </div>
    </details>
  );
}

function QueuePanel({ groups }: { groups: QueuedGroup[] }) {
  const t = useTranslations("scan");
  const visible = groups.filter((g) => g.status !== "capturing");
  return (
    <section aria-labelledby="queue-heading" className="flex flex-col gap-2">
      <h2 id="queue-heading" className="text-sm font-medium uppercase tracking-wide text-ink-muted">
        {t("queue")}
      </h2>
      {visible.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("queueEmpty")}</p>
      ) : (
        <ul
          className="divide-y divide-rule rounded-[var(--radius-card)] border border-rule bg-card"
          data-testid="upload-queue"
        >
          {visible.map((g) => (
            <li key={g.clientRef} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
              <span className="truncate">{g.studentName ?? t("unknownStudent")}</span>
              <span
                className={cn(
                  g.status === "error" ? "text-pen-red" : g.status === "done" ? "text-pen-green" : "text-ink-muted",
                )}
              >
                {g.status === "error" && g.error ? t(`queueErrors.${g.error}`) : t(`groupStatus.${g.status}`)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {visible.some((g) => g.status === "error") && (
        <Button variant="ghost" onClick={() => void kick()} className="self-start">
          <RotateCcw aria-hidden /> {t("retryNow")}
        </Button>
      )}
    </section>
  );
}

function PdfUpload({ assignmentId, online }: { assignmentId: string; online: boolean }) {
  const t = useTranslations("scan");
  const router = useRouter();
  const [per, setPer] = useState(1);
  const [state, setState] = useState<"idle" | "uploading" | "started" | "error">("idle");
  return (
    <details className="rounded-[var(--radius-card)] border border-rule bg-card p-4">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-medium">
        <FileText aria-hidden className="size-4" /> {t("pdfTitle")}
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-sm text-ink-muted">{t("pdfHint")}</p>
        <div className="flex flex-col gap-1">
          <Label htmlFor="pdf-per">{t("pagesPerStudentNoQr")}</Label>
          <Select id="pdf-per" value={per} onChange={(e) => setPer(Number(e.target.value))} className="max-w-32">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </div>
        <Input
          type="file"
          accept="application/pdf"
          disabled={!online || state === "uploading"}
          aria-label={t("pdfTitle")}
          className="py-2"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            if (file.size > 50 * 1024 * 1024) return setState("error");
            setState("uploading");
            const prep = await preparePdfImport({ assignmentId, pagesPerStudent: per });
            if (!prep.ok) return setState("error");
            const { error } = await createSupabaseBrowserClient()
              .storage.from("pages-original")
              .upload(prep.path, file, { contentType: "application/pdf", upsert: false });
            if (error) return setState("error");
            const started = await startPdfImport(prep.importId);
            setState(started.ok ? "started" : "error");
            if (started.ok) router.refresh();
          }}
        />
        {!online && <p className="text-sm text-pen-amber">{t("pdfNeedsOnline")}</p>}
        <p role="status" className="text-sm">
          {state === "uploading" && t("pdfUploading")}
          {state === "started" && <span className="text-pen-green">{t("pdfStarted")}</span>}
          {state === "error" && <span className="text-pen-red">{t("pdfError")}</span>}
        </p>
      </div>
    </details>
  );
}
