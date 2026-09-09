export type FormationBlockType = "paragraph" | "video" | "image" | "pdf";

export type FormationBlock = {
  id: string;
  type: FormationBlockType;
  title: string;
  text: string;
  url: string;
  storageKey: string;
  fileName: string;
  mimeType: string;
};

export type FormationOption = { id: string; text: string };
export type FormationQuestion = {
  id: string;
  prompt: string;
  options: FormationOption[];
  correctOptionId: string;
  explanation: string;
};

export type FormationQuiz = { passingScore: number; questions: FormationQuestion[] };
export type FormationLesson = { id: string; title: string; objective: string; durationMinutes: number; blocks: FormationBlock[]; quiz: FormationQuiz };
export type FormationChapter = { id: string; title: string; description: string; lessons: FormationLesson[] };
export type FormationContent = { chapters: FormationChapter[] };

export type FormationCourse = {
  id: string;
  slug: string;
  title: string;
  description: string;
  audience: string;
  durationHours: number;
  status: "draft" | "published";
  content: FormationContent;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function safeText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function safeUrl(value: unknown) {
  const text = safeText(value, 2000);
  if (!text) return "";
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch { return ""; }
}

export function slugifyFormation(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "formacion-aba";
}

export function blankFormationBlock(type: FormationBlockType): FormationBlock {
  return { id: crypto.randomUUID(), type, title: "", text: "", url: "", storageKey: "", fileName: "", mimeType: "" };
}

export function blankFormationLesson(): FormationLesson {
  return { id: crypto.randomUUID(), title: "Nueva clase", objective: "", durationMinutes: 30, blocks: [], quiz: { passingScore: 80, questions: [] } };
}

export function blankFormationChapter(): FormationChapter {
  return { id: crypto.randomUUID(), title: "Nuevo capítulo", description: "", lessons: [blankFormationLesson()] };
}

export function blankFormationQuestion(): FormationQuestion {
  const options = [{ id: crypto.randomUUID(), text: "" }, { id: crypto.randomUUID(), text: "" }];
  return { id: crypto.randomUUID(), prompt: "", options, correctOptionId: options[0].id, explanation: "" };
}

export function normalizeFormationContent(value: unknown): FormationContent {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawChapters = Array.isArray(raw.chapters) ? raw.chapters : [];
  return { chapters: rawChapters.slice(0, 40).map((chapterValue) => {
    const chapter = chapterValue && typeof chapterValue === "object" ? chapterValue as Record<string, unknown> : {};
    const rawLessons = Array.isArray(chapter.lessons) ? chapter.lessons : [];
    return {
      id: safeText(chapter.id, 100) || crypto.randomUUID(), title: safeText(chapter.title, 180), description: safeText(chapter.description, 1200),
      lessons: rawLessons.slice(0, 80).map((lessonValue) => {
        const lesson = lessonValue && typeof lessonValue === "object" ? lessonValue as Record<string, unknown> : {};
        const rawBlocks = Array.isArray(lesson.blocks) ? lesson.blocks : [];
        const rawQuiz = lesson.quiz && typeof lesson.quiz === "object" ? lesson.quiz as Record<string, unknown> : {};
        const rawQuestions = Array.isArray(rawQuiz.questions) ? rawQuiz.questions : [];
        return {
          id: safeText(lesson.id, 100) || crypto.randomUUID(), title: safeText(lesson.title, 180), objective: safeText(lesson.objective, 1500),
          durationMinutes: Math.min(600, Math.max(1, Number(lesson.durationMinutes) || 30)),
          blocks: rawBlocks.slice(0, 60).map((blockValue) => {
            const block = blockValue && typeof blockValue === "object" ? blockValue as Record<string, unknown> : {};
            const type = (["paragraph", "video", "image", "pdf"] as const).includes(block.type as FormationBlockType) ? block.type as FormationBlockType : "paragraph";
            return { id: safeText(block.id, 100) || crypto.randomUUID(), type, title: safeText(block.title, 180), text: safeText(block.text, 20000), url: safeUrl(block.url), storageKey: safeText(block.storageKey, 400), fileName: safeText(block.fileName, 260), mimeType: safeText(block.mimeType, 100) };
          }),
          quiz: { passingScore: Math.min(100, Math.max(1, Number(rawQuiz.passingScore) || 80)), questions: rawQuestions.slice(0, 50).map((questionValue) => {
            const question = questionValue && typeof questionValue === "object" ? questionValue as Record<string, unknown> : {};
            const rawOptions = Array.isArray(question.options) ? question.options : [];
            const options = rawOptions.slice(0, 8).map((optionValue) => {
              const option = optionValue && typeof optionValue === "object" ? optionValue as Record<string, unknown> : {};
              return { id: safeText(option.id, 100) || crypto.randomUUID(), text: safeText(option.text, 600) };
            });
            return { id: safeText(question.id, 100) || crypto.randomUUID(), prompt: safeText(question.prompt, 1200), options, correctOptionId: safeText(question.correctOptionId, 100), explanation: safeText(question.explanation, 1800) };
          }) },
        };
      }),
    };
  }) };
}

export function validateFormationContent(content: FormationContent, publishing = false) {
  if (content.chapters.length > 40) return "La formación admite como máximo 40 capítulos.";
  if (publishing && !content.chapters.length) return "Agrega al menos un capítulo antes de publicar.";
  for (const [chapterIndex, chapter] of content.chapters.entries()) {
    if (!chapter.title) return `Escribe el título del capítulo ${chapterIndex + 1}.`;
    if (publishing && !chapter.lessons.length) return `Agrega al menos una clase en ${chapter.title}.`;
    for (const [lessonIndex, lesson] of chapter.lessons.entries()) {
      if (!lesson.title) return `Escribe el título de la clase ${lessonIndex + 1} en ${chapter.title}.`;
      if (publishing && !lesson.blocks.length) return `Agrega contenido a la clase “${lesson.title}”.`;
      for (const block of lesson.blocks) {
        if (block.type === "paragraph" && !block.text) return `Completa el párrafo de “${lesson.title}”.`;
        if (block.type !== "paragraph" && !block.url && !block.storageKey) return `Agrega el archivo o enlace de ${block.type} en “${lesson.title}”.`;
      }
      for (const [questionIndex, question] of lesson.quiz.questions.entries()) {
        if (!question.prompt) return `Completa la pregunta ${questionIndex + 1} de “${lesson.title}”.`;
        if (question.options.length < 2 || question.options.some((option) => !option.text)) return `Completa al menos dos opciones en la pregunta ${questionIndex + 1}.`;
        if (!question.options.some((option) => option.id === question.correctOptionId)) return `Selecciona la respuesta correcta de la pregunta ${questionIndex + 1}.`;
      }
    }
  }
  return "";
}

export function formationStorageKeys(content: FormationContent) {
  return content.chapters.flatMap((chapter) => chapter.lessons).flatMap((lesson) => lesson.blocks).map((block) => block.storageKey).filter(Boolean);
}

export function parseFormationCourse(row: Record<string, unknown>): FormationCourse {
  let parsed: unknown = { chapters: [] };
  try { parsed = typeof row.content === "string" ? JSON.parse(row.content) : row.content; } catch { parsed = { chapters: [] }; }
  return { ...(row as unknown as FormationCourse), status: row.status === "published" ? "published" : "draft", content: normalizeFormationContent(parsed) };
}
