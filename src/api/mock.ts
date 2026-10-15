/**
 * In-memory API used when the UI runs in a plain browser (`pnpm dev`).
 * Mirrors the Rust behaviour closely enough for layout and interaction work.
 */
import type { AiEvent, AiNoteResult, Api, Counts, Folder, JobEvent, LevelEvent, ModelInfo, ModelProgress, NoteFull, NoteSummary, Recording, Transcript, TranscriptEvent, TranscriptPartialEvent } from "./types";

const h = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const now = () => new Date().toISOString();
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

function doc(lines: string[]): string {
  return JSON.stringify({
    type: "doc",
    content: lines.map((text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : undefined })),
  });
}

function seedNote(p: {
  folderId: string | null;
  lines: string[];
  lang: string;
  pinned?: boolean;
  hasAudio?: boolean;
  hoursAgo: number;
  deleted?: boolean;
}): NoteFull {
  const [title = "", ...rest] = p.lines;
  return {
    id: uid(),
    folderId: p.folderId,
    title,
    preview: rest.join(" ").slice(0, 240),
    blocksJson: doc(p.lines),
    pinned: !!p.pinned,
    lang: p.lang,
    hasAudio: !!p.hasAudio,
    createdAt: h(p.hoursAgo + 1),
    updatedAt: h(p.hoursAgo),
    deletedAt: p.deleted ? h(p.hoursAgo) : null,
  };
}

let folders: Folder[] = [
  { id: "f-work", name: "Ish", parentId: null, sort: 1, createdAt: h(100) },
  { id: "f-study", name: "Dars", parentId: null, sort: 2, createdAt: h(100) },
  { id: "f-personal", name: "Shaxsiy", parentId: null, sort: 3, createdAt: h(100) },
];

let notes: NoteFull[] = [
  seedNote({
    folderId: "f-work",
    lang: "uz",
    pinned: true,
    hasAudio: true,
    hoursAgo: 2,
    lines: [
      "Jamoa uchrashuvi — oktabr reja",
      "Asosiy qarorlar: dizayn tizimi oktabr oxirigacha, lokal STT prototipi 2 haftada tayyor bo'lishi kerak.",
      "Vazifalar: Dovudbek — Tauri shell va Apple-style UI; Jasur — whisper.cpp integratsiya; Malika — test audio to'plami (uz/ar).",
      "Keyingi uchrashuv: juma, 15:00. Demo ko'rsatamiz.",
    ],
  }),
  seedNote({
    folderId: "f-study",
    lang: "ar",
    hasAudio: true,
    hoursAgo: 5,
    lines: [
      "محاضرة: مقدمة في معالجة الإشارات الصوتية",
      "تحويل فورييه يحوّل الإشارة من المجال الزمني إلى المجال الترددي. نستخدم تردد أخذ عينات 16 كيلوهرتز لأن الكلام البشري يقع تحت 8 كيلوهرتز.",
      "Mel spectrogram يقرّب إدراك الأذن البشرية للترددات، وهو المدخل الأساسي لنماذج مثل Whisper.",
    ],
  }),
  seedNote({ folderId: "f-personal", lang: "uz", hoursAgo: 26, lines: ["Xarid ro'yxati", "Sut", "Non", "Qahva", "Batareya (AA)"] }),
  seedNote({
    folderId: "f-work",
    lang: "uz",
    hasAudio: true,
    hoursAgo: 28,
    lines: [
      "Mijoz bilan qo'ng'iroq — ATA",
      "Ular lokal ishlashini talab qilmoqda, ma'lumot tashqariga chiqmasligi kerak. Bulut variantini rad etishdi.",
      "Arabcha yozuvlar ko'p — Misr dialekti. Whisper turbo sinab ko'ramiz.",
    ],
  }),
  seedNote({
    folderId: "f-study",
    lang: "uz",
    hoursAgo: 24 * 3,
    lines: ["Rust: ownership va borrowing", "Har bir qiymatning bitta egasi bor. Egasi scope'dan chiqsa — drop.", "& — immutable borrow, &mut — mutable borrow."],
  }),
  seedNote({
    folderId: "f-personal",
    lang: "ar",
    pinned: true,
    hoursAgo: 24 * 6,
    lines: ["فكرة تطبيق: مذكّرات صوتية للعائلة", "تسجيل قصص الجد وتحويلها إلى نص مع شجرة عائلة تفاعلية."],
  }),
  seedNote({ folderId: "f-work", lang: "uz", hoursAgo: 24 * 12, lines: ["Model manager UI eskizi", "Alohida oyna. Har model: nom, hajm, RAM, status."] }),
  seedNote({ folderId: "f-personal", lang: "uz", hoursAgo: 24 * 20, deleted: true, lines: ["Eski eslatma", "O'chirilgan — savatda"] }),
];

const summary = ({ blocksJson: _b, ...s }: NoteFull): NoteSummary => s;
const sortNotes = (list: NoteFull[]) =>
  [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
const find = (id: string) => {
  const n = notes.find((x) => x.id === id);
  if (!n) throw new Error(`not found: note ${id}`);
  return n;
};

export const mockApi: Api = {
  async foldersList() {
    return [...folders].sort((a, b) => a.sort - b.sort);
  },
  async folderCreate(name) {
    const f: Folder = { id: uid(), name: name.trim(), parentId: null, sort: folders.length + 1, createdAt: now() };
    folders.push(f);
    return f;
  },
  async folderRename(id, name) {
    folders = folders.map((f) => (f.id === id ? { ...f, name: name.trim() } : f));
  },
  async folderDelete(id) {
    folders = folders.filter((f) => f.id !== id);
    notes = notes.map((n) => (n.folderId === id ? { ...n, folderId: null } : n));
  },

  async notesList(folder, query) {
    let list = notes.filter((n) => (folder === "trash" ? n.deletedAt : !n.deletedAt));
    if (folder === "pinned") list = list.filter((n) => n.pinned);
    else if (!["all", "recent", "trash"].includes(folder)) list = list.filter((n) => n.folderId === folder);
    const q = query?.trim().toLowerCase();
    if (q) list = list.filter((n) => (n.title + " " + n.preview).toLowerCase().includes(q));
    list = sortNotes(list);
    if (folder === "recent") list = list.slice(0, 20);
    return list.map(summary);
  },
  async notesCounts() {
    const live = notes.filter((n) => !n.deletedAt);
    const c: Counts = { all: live.length, pinned: live.filter((n) => n.pinned).length, trash: notes.length - live.length, byFolder: {} };
    for (const n of live) if (n.folderId) c.byFolder[n.folderId] = (c.byFolder[n.folderId] ?? 0) + 1;
    return c;
  },
  async noteGet(id) {
    return { ...find(id) };
  },
  async noteCreate(folderId, lang) {
    const n: NoteFull = {
      id: uid(),
      folderId,
      title: "",
      preview: "",
      blocksJson: doc([""]),
      pinned: false,
      lang,
      hasAudio: false,
      createdAt: now(),
      updatedAt: now(),
      deletedAt: null,
    };
    notes.unshift(n);
    return { ...n };
  },
  async noteSave(input) {
    const n = find(input.id);
    Object.assign(n, { title: input.title, preview: input.preview, blocksJson: input.blocksJson, updatedAt: now() });
    return n.updatedAt;
  },
  async noteSetPinned(id, pinned) {
    find(id).pinned = pinned;
  },
  async noteSetLang(id, lang) {
    find(id).lang = lang;
  },
  async noteMove(id, folderId) {
    find(id).folderId = folderId;
  },
  async noteTrash(id) {
    Object.assign(find(id), { deletedAt: now(), pinned: false });
  },
  async noteRestore(id) {
    find(id).deletedAt = null;
  },
  async noteDeleteForever(id) {
    notes = notes.filter((n) => n.id !== id);
  },
  async trashEmpty() {
    const before = notes.length;
    notes = notes.filter((n) => !n.deletedAt);
    return before - notes.length;
  },

  attachmentSave(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  },

  async modelsList() {
    return MOCK_MODELS.map((m) => ({ ...m }));
  },
  async modelDownload(id) {
    const m = MOCK_MODELS.find((x) => x.id === id);
    if (!m || m.status === "ready" || m.status === "downloading") return;
    m.status = "downloading";
    m.error = null;
    const speed = 60_000_000; // 60 MB/s simulated
    const tick = () => {
      if (m.status !== "downloading") return;
      m.downloadedBytes = Math.min(m.size, m.downloadedBytes + speed / 4);
      m.bytesPerSec = speed;
      if (m.downloadedBytes >= m.size) {
        m.status = "ready";
        m.bytesPerSec = 0;
        m.path = `/mock/models/${m.kind}/${m.file}`;
        emitProgress(m);
        return;
      }
      emitProgress(m);
      timers.set(id, window.setTimeout(tick, 250));
    };
    tick();
  },
  async modelPause(id) {
    const m = MOCK_MODELS.find((x) => x.id === id);
    if (!m) return;
    window.clearTimeout(timers.get(id));
    m.status = "paused";
    m.bytesPerSec = 0;
    emitProgress(m);
  },
  async modelImportFile(id) {
    const m = MOCK_MODELS.find((x) => x.id === id);
    if (m) Object.assign(m, { status: "ready", downloadedBytes: m.size, path: `/mock/models/${m.kind}/${m.file}` });
    if (m) emitProgress(m);
  },
  async modelDelete(id) {
    const m = MOCK_MODELS.find((x) => x.id === id);
    if (!m) return;
    window.clearTimeout(timers.get(id));
    Object.assign(m, { status: "missing", downloadedBytes: 0, bytesPerSec: 0, path: null, error: null });
    emitProgress(m);
  },
  async systemInfo() {
    return { ramGb: 16, arch: "aarch64", os: "macos", cpu: "Apple M4 (mock)", diskFreeBytes: 42_000_000_000 };
  },
  async openModelsWindow() {
    window.open("/models.html", "plaudenote-models", "width=640,height=700");
  },
  async revealModelsDir() {
    /* no-op in browser */
  },
  async onModelProgress(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },

  // ── recorder (simulated) ─────────────────────────────────────────────
  async recordingStart() {
    rec.startedAt = Date.now();
    rec.id = uid();
    rec.timer = window.setInterval(() => {
      const t = (Date.now() - rec.startedAt) / 1000;
      const rms = 0.08 + 0.12 * Math.abs(Math.sin(t * 3)) + Math.random() * 0.05;
      levelListeners.forEach((cb) => cb({ rms, peak: rms * 1.6, elapsedMs: Date.now() - rec.startedAt }));
    }, 100);
    return { id: rec.id, path: `/mock/${rec.id}.wav` };
  },
  async recordingStop(noteId, lang) {
    window.clearInterval(rec.timer);
    const r: Recording = { id: rec.id, noteId, path: `/mock/${rec.id}.wav`, durationMs: Date.now() - rec.startedAt, lang, source: "mic", createdAt: now() };
    recordings.push(r);
    return r;
  },
  async recordingCancel() {
    window.clearInterval(rec.timer);
  },
  async pickAudioFiles() {
    return [`/mock/upload-${Date.now()}.m4a`];
  },
  async attachmentImport(path) {
    return path;
  },
  async recordingImport(path, noteId, lang, tempId) {
    const base = { id: tempId ?? "", recordingId: tempId ?? "", noteId, stage: "decode" as const, progress: 0, error: null };
    jobListeners.forEach((cb) => cb({ ...base, status: "running" }));
    await new Promise((r) => window.setTimeout(r, 1500)); // pretend to decode
    jobListeners.forEach((cb) => cb({ ...base, status: "done" }));
    const r: Recording = { id: uid(), noteId, path, durationMs: 83_000, lang, source: "upload", createdAt: now() };
    recordings.push(r);
    return r;
  },
  async jobCancel(jobId) {
    const t = mockJobs.get(jobId);
    if (!t) return false;
    window.clearTimeout(t.timer);
    mockJobs.delete(jobId);
    jobListeners.forEach((cb) => cb({ ...t.base, status: "cancelled", progress: 0 }));
    return true;
  },
  async recordingsList(noteId) {
    return recordings.filter((r) => r.noteId === noteId);
  },
  async transcribeStart(recordingId, lang) {
    const r = recordings.find((x) => x.id === recordingId);
    const jobId = uid();
    const base = { id: jobId, recordingId, noteId: r?.noteId ?? null, stage: "transcribe" as const, error: null };
    jobListeners.forEach((cb) => cb({ ...base, status: "queued", progress: 0 }));
    let p = 0;
    const tick = () => {
      p += 0.2;
      if (p < 1) {
        jobListeners.forEach((cb) => cb({ ...base, status: "running", progress: p }));
        mockJobs.set(jobId, { base, timer: window.setTimeout(tick, 600) });
        return;
      }
      mockJobs.delete(jobId);
      const ar = lang === "ar";
      const segs = ar
        ? [
            { startMs: 0, endMs: 2400, text: "السلام عليكم، هذا تسجيل تجريبي." },
            { startMs: 2400, endMs: 6100, text: "نتحدث اليوم عن خطة المشروع والمهام القادمة." },
            { startMs: 6100, endMs: 9000, text: "المهمة الأولى: إنهاء التصميم قبل نهاية الأسبوع." },
          ]
        : [
            { startMs: 0, endMs: 2300, text: "Assalomu alaykum, bu sinov yozuvi." },
            { startMs: 2300, endMs: 6000, text: "Bugun loyiha rejasi va keyingi vazifalar haqida gaplashamiz." },
            { startMs: 6000, endMs: 9200, text: "Birinchi vazifa: dizaynni hafta oxirigacha tugatish." },
          ];
      const t: Transcript = { id: uid(), recordingId, langDetected: ar ? "ar" : "uz", segments: segs, text: segs.map((s) => s.text).join(" "), model: "mock", createdAt: now() };
      transcripts.set(recordingId, t);
      jobListeners.forEach((cb) => cb({ ...base, status: "done", progress: 1 }));
      transcriptListeners.forEach((cb) => cb({ recordingId, noteId: r?.noteId ?? null, transcript: t }));
    };
    mockJobs.set(jobId, { base, timer: window.setTimeout(tick, 900) });
    return jobId;
  },
  async transcriptGet(recordingId) {
    return transcripts.get(recordingId) ?? null;
  },
  audioSrc: () => "",
  async onRecordLevel(cb) {
    levelListeners.add(cb);
    return () => levelListeners.delete(cb);
  },
  async onJobUpdate(cb) {
    jobListeners.add(cb);
    return () => jobListeners.delete(cb);
  },
  async onTranscriptReady(cb) {
    transcriptListeners.add(cb);
    return () => transcriptListeners.delete(cb);
  },
  async onTranscriptPartial(cb) {
    partialListeners.add(cb);
    return () => partialListeners.delete(cb);
  },

  // ── AI (simulated) ───────────────────────────────────────────────────
  async aiNote(noteId, recordingId, o = {}) {
    const targetLang = o.targetLang;
    const jobId = uid();
    const t = transcripts.get(recordingId);
    const lang = targetLang && targetLang !== "auto" ? targetLang : (t?.langDetected ?? "uz");
    const base = { id: jobId, recordingId, noteId, stage: "summarize" as const, error: null };
    jobListeners.forEach((cb) => cb({ ...base, status: "running", progress: 0.3 }));
    const timer = window.setTimeout(() => {
      mockJobs.delete(jobId);
      jobListeners.forEach((cb) => cb({ ...base, status: "done", progress: 1 }));
      aiListeners.forEach((cb) => cb({ jobId, noteId, recordingId, task: "note", lang, result: mockNote(lang) }));
    }, 2500);
    mockJobs.set(jobId, { base, timer });
    return jobId;
  },
  async aiTask(noteId, task, text, lang, o = {}) {
    const targetLang = o.targetLang;
    const jobId = uid();
    const base = { id: jobId, recordingId: "", noteId, stage: "summarize" as const, error: null };
    jobListeners.forEach((cb) => cb({ ...base, status: "running", progress: 0.3 }));
    window.setTimeout(() => {
      const n = mockNote(targetLang && targetLang !== "auto" ? targetLang : lang === "auto" ? "uz" : lang);
      const result =
        task === "mindmap" ? n.mindmap
        : task === "todos" ? { action_items: n.action_items }
        : task === "summary" ? { text: n.summary }
        : task === "translate" ? { text: `[${targetLang}] ${text.slice(0, 200)}` }
        : task === "ask" ? { text: `Savol: ${o.question ?? ""}\n\nJavob (mock): matnda ${text.split(/\s+/).length} ta so'z bor. ${o.instruction ? `Ko'rsatma: ${o.instruction}` : ""}` }
        : n;
      jobListeners.forEach((cb) => cb({ ...base, status: "done", progress: 1 }));
      aiListeners.forEach((cb) => cb({ jobId, noteId, recordingId: null, task, lang: targetLang && targetLang !== "auto" && task !== "translate" ? targetLang : lang, result }));
    }, 1200);
    return jobId;
  },
  async llmStatus() {
    return { running: false, model: null, port: null };
  },
  async onAiReady(cb) {
    aiListeners.add(cb);
    return () => aiListeners.delete(cb);
  },
};

const aiListeners = new Set<(e: AiEvent) => void>();
function mockNote(lang: string): AiNoteResult {
  if (lang === "ar") {
    return {
      title: "خطة المشروع والمهام القادمة",
      summary: "ناقش الفريق خطة المشروع للأسبوع القادم. تم الاتفاق على إنهاء التصميم أولًا ثم بدء التطوير.",
      key_points: ["إنهاء التصميم قبل نهاية الأسبوع", "بدء التطوير بعد اعتماد التصميم", "اجتماع متابعة يوم الجمعة"],
      action_items: [{ text: "إنهاء التصميم", owner: "سارة", due: "الجمعة" }, { text: "تجهيز بيئة التطوير", owner: "", due: "" }],
      decisions: ["التصميم أولًا ثم التطوير"],
      mindmap: { name: "خطة المشروع", children: [{ name: "التصميم", children: [{ name: "الواجهة" }, { name: "الألوان" }] }, { name: "التطوير", children: [{ name: "الواجهة الخلفية" }, { name: "الاختبارات" }] }, { name: "الاجتماعات", children: [{ name: "الجمعة" }] }] },
      chart: { kind: "bar", title: "المهام حسب الأسبوع", categories: ["الأسبوع ١", "الأسبوع ٢", "الأسبوع ٣"], values: [4, 7, 3] },
    };
  }
  return {
    title: "Loyiha rejasi va keyingi vazifalar",
    summary: "Jamoa keyingi hafta uchun loyiha rejasini muhokama qildi. Avval dizayn tugatiladi, keyin dasturlash boshlanadi.",
    key_points: ["Dizayn hafta oxirigacha tugaydi", "Dizayn tasdiqlangach dasturlash boshlanadi", "Juma kuni nazorat uchrashuvi"],
    action_items: [{ text: "Dizaynni tugatish", owner: "Malika", due: "Juma" }, { text: "Dev muhitini tayyorlash", owner: "", due: "" }],
    decisions: ["Avval dizayn, keyin dasturlash"],
    mindmap: { name: "Loyiha rejasi", children: [{ name: "Dizayn", children: [{ name: "Interfeys" }, { name: "Ranglar" }] }, { name: "Dasturlash", children: [{ name: "Backend" }, { name: "Testlar" }] }, { name: "Uchrashuvlar", children: [{ name: "Juma" }] }] },
    chart: { kind: "bar", title: "Haftalar bo'yicha vazifalar", categories: ["1-hafta", "2-hafta", "3-hafta"], values: [4, 7, 3] },
  };
}

const rec = { id: "", startedAt: 0, timer: 0 as number };
const mockJobs = new Map<string, { base: Omit<JobEvent, "status" | "progress">; timer: number }>();
const recordings: Recording[] = [];
const transcripts = new Map<string, Transcript>();
const levelListeners = new Set<(e: LevelEvent) => void>();
const jobListeners = new Set<(e: JobEvent) => void>();
const transcriptListeners = new Set<(e: TranscriptEvent) => void>();
const partialListeners = new Set<(e: TranscriptPartialEvent) => void>();

// ── mock model catalogue (mirrors src-tauri/src/models/registry.rs) ────────
const listeners = new Set<(p: ModelProgress) => void>();
const timers = new Map<string, number>();
function emitProgress(m: ModelInfo) {
  const p: ModelProgress = { id: m.id, status: m.status, downloadedBytes: m.downloadedBytes, totalBytes: m.size, bytesPerSec: m.bytesPerSec, error: m.error };
  listeners.forEach((cb) => cb(p));
}
// Browser dev: pretend the recommended stack is already installed so the whole flow is clickable.
const PRE_INSTALLED = new Set(["whisper-large-v3-turbo-q5", "qwen3.5-4b-q4", "llama-server"]);
const model = (m: Omit<ModelInfo, "status" | "downloadedBytes" | "bytesPerSec" | "error" | "path" | "langsOnly"> & { langsOnly?: string[] }): ModelInfo => ({
  langsOnly: null,
  ...m,
  status: PRE_INSTALLED.has(m.id) ? "ready" : "missing",
  downloadedBytes: PRE_INSTALLED.has(m.id) ? m.size : 0,
  bytesPerSec: 0,
  error: null,
  path: PRE_INSTALLED.has(m.id) ? `/mock/models/${m.kind}/${m.file}` : null,
});
const MOCK_MODELS: ModelInfo[] = [
  model({ id: "whisper-large-v3-turbo-q5", kind: "stt", name: "Whisper large-v3 turbo", description: "Best quality for Uzbek and Arabic. Q5_0 quantised.", file: "ggml-large-v3-turbo-q5_0.bin", url: "", size: 574_041_195, minRamGb: 8, langs: "uz, ar, en +96", archive: false, defaultFor16gb: true, defaultFor8gb: true }),
  model({ id: "whisper-uzbek-kotib-medium", kind: "stt", name: "Whisper Uzbek (Kotib, medium)", description: "Fine-tuned on 1,600 h of Uzbek speech. Dramatically better Uzbek than turbo; Uzbek only.", file: "ggml-uzbek-kotib-medium-q5_0.bin", url: "", size: 539_212_484, minRamGb: 8, langs: "uz", langsOnly: ["uz"], archive: false, defaultFor16gb: true, defaultFor8gb: true }),
  model({ id: "whisper-uzbek-rubai-medium", kind: "stt", name: "Whisper Uzbek (rubaiSTT v2, medium)", description: "Tashkent-dialect podcasts and news (475 h). Alternative to Kotib; Uzbek only.", file: "ggml-uzbek-rubai-medium-q5_0.bin", url: "", size: 539_212_484, minRamGb: 8, langs: "uz", langsOnly: ["uz"], archive: false, defaultFor16gb: false, defaultFor8gb: false }),
  model({ id: "whisper-small-q5", kind: "stt", name: "Whisper small", description: "Fast, lower accuracy. Good for quick drafts.", file: "ggml-small-q5_1.bin", url: "", size: 190_085_487, minRamGb: 4, langs: "uz, ar, en +96", archive: false, defaultFor16gb: false, defaultFor8gb: false }),
  model({ id: "qwen3.5-4b-q4", kind: "llm", name: "Qwen3.5 4B", description: "Summaries, to-dos and mind maps. 201 languages. Fits 8 GB Macs.", file: "Qwen3.5-4B-Q4_K_M.gguf", url: "", size: 2_740_937_888, minRamGb: 8, langs: "uz, ar, en +198", archive: false, defaultFor16gb: false, defaultFor8gb: true }),
  model({ id: "qwen3.5-9b-q4", kind: "llm", name: "Qwen3.5 9B", description: "Noticeably better Uzbek. Needs 16 GB.", file: "Qwen3.5-9B-Q4_K_M.gguf", url: "", size: 5_680_522_464, minRamGb: 16, langs: "uz, ar, en +198", archive: false, defaultFor16gb: true, defaultFor8gb: false }),
  model({ id: "gemma-4-e4b-q4", kind: "llm", name: "Gemma 4 E4B", description: "Google's small multilingual model. Alternative to Qwen.", file: "gemma-4-E4B-it-Q4_K_M.gguf", url: "", size: 4_977_171_584, minRamGb: 12, langs: "uz, ar, en +137", archive: false, defaultFor16gb: false, defaultFor8gb: false }),
  model({ id: "llama-server", kind: "runtime", name: "llama.cpp server", description: "Runs the language model on the GPU (Metal). Required once.", file: "llama-cpp", url: "", size: 12_012_019, minRamGb: 0, langs: "", archive: true, defaultFor16gb: true, defaultFor8gb: true }),
];
