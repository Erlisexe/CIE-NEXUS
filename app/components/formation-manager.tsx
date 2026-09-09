"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, BookOpen, CheckCircle2, Clipboard, Eye, FileText, GraduationCap, ImageIcon, LoaderCircle, Pencil, PlayCircle, Plus, Save, Send, Trash2, Upload } from "lucide-react";
import {
  blankFormationBlock,
  blankFormationChapter,
  blankFormationLesson,
  blankFormationQuestion,
  type FormationBlock,
  type FormationBlockType,
  type FormationCourse,
} from "../../lib/formation";

type Props = { notify: (message: string) => void };

function move<T>(items: T[], index: number, direction: -1 | 1) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return items;
  const next = [...items];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

function totalLessons(course: FormationCourse) {
  return course.content.chapters.reduce((total, chapter) => total + chapter.lessons.length, 0);
}

function totalQuestions(course: FormationCourse) {
  return course.content.chapters.flatMap((chapter) => chapter.lessons).reduce((total, lesson) => total + lesson.quiz.questions.length, 0);
}

export default function FormationManager({ notify }: Props) {
  const [courses, setCourses] = useState<FormationCourse[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState("");
  const selected = useMemo(() => courses.find((course) => course.id === selectedId) || courses[0] || null, [courses, selectedId]);

  useEffect(() => {
    fetch("/api/formation").then(async (response) => {
      const data = await response.json() as { courses?: FormationCourse[]; error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo cargar Formación.");
      setCourses(data.courses || []);
      setSelectedId(data.courses?.[0]?.id || "");
    }).catch((error: Error) => notify(error.message)).finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function replaceCourse(next: FormationCourse) {
    setCourses((current) => current.map((course) => course.id === next.id ? next : course));
  }

  function patchCourse(patch: Partial<FormationCourse>) {
    if (selected) replaceCourse({ ...selected, ...patch });
  }

  async function createCourse() {
    setBusy(true);
    try {
      const response = await fetch("/api/formation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Nueva formación", durationHours: 45 }) });
      const data = await response.json() as { course?: FormationCourse; error?: string };
      if (!response.ok || !data.course) throw new Error(data.error || "No se pudo crear.");
      setCourses((current) => [data.course!, ...current]); setSelectedId(data.course.id); notify("Formación creada como borrador.");
    } catch (error) { notify(error instanceof Error ? error.message : "No se pudo crear."); }
    finally { setBusy(false); }
  }

  async function persist(action: "save" | "publish" | "unpublish" = "save") {
    if (!selected) return;
    setBusy(true);
    try {
      const response = await fetch("/api/formation", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...selected, action }) });
      const data = await response.json() as { course?: FormationCourse; error?: string };
      if (!response.ok || !data.course) throw new Error(data.error || "No se pudo guardar.");
      replaceCourse(data.course);
      notify(action === "publish" ? "Formación publicada y disponible mediante su enlace." : action === "unpublish" ? "Formación retirada del campus público." : "Borrador guardado.");
    } catch (error) { notify(error instanceof Error ? error.message : "No se pudo guardar."); }
    finally { setBusy(false); }
  }

  async function deleteCourse() {
    if (!selected || !window.confirm(`¿Eliminar permanentemente “${selected.title}” y todos sus materiales?`)) return;
    setBusy(true);
    try {
      const response = await fetch("/api/formation", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selected.id }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo eliminar.");
      const next = courses.filter((course) => course.id !== selected.id); setCourses(next); setSelectedId(next[0]?.id || ""); notify("Formación eliminada permanentemente.");
    } catch (error) { notify(error instanceof Error ? error.message : "No se pudo eliminar."); }
    finally { setBusy(false); }
  }

  async function shareCourse() {
    if (!selected) return;
    if (selected.status !== "published") { notify("Publica la formación antes de compartirla."); return; }
    const url = `${window.location.origin}/formacion/${selected.slug}`;
    await navigator.clipboard.writeText(url);
    notify("Enlace público copiado.");
  }

  function updateChapter(index: number, patch: Partial<FormationCourse["content"]["chapters"][number]>) {
    if (!selected) return;
    const chapters = selected.content.chapters.map((chapter, chapterIndex) => chapterIndex === index ? { ...chapter, ...patch } : chapter);
    patchCourse({ content: { chapters } });
  }

  function updateLesson(chapterIndex: number, lessonIndex: number, patch: Partial<FormationCourse["content"]["chapters"][number]["lessons"][number]>) {
    if (!selected) return;
    const chapter = selected.content.chapters[chapterIndex];
    const lessons = chapter.lessons.map((lesson, index) => index === lessonIndex ? { ...lesson, ...patch } : lesson);
    updateChapter(chapterIndex, { lessons });
  }

  function updateBlock(chapterIndex: number, lessonIndex: number, blockIndex: number, patch: Partial<FormationBlock>) {
    if (!selected) return;
    const lesson = selected.content.chapters[chapterIndex].lessons[lessonIndex];
    updateLesson(chapterIndex, lessonIndex, { blocks: lesson.blocks.map((block, index) => index === blockIndex ? { ...block, ...patch } : block) });
  }

  async function uploadBlock(chapterIndex: number, lessonIndex: number, blockIndex: number, file?: File) {
    if (!selected || !file) return;
    const block = selected.content.chapters[chapterIndex].lessons[lessonIndex].blocks[blockIndex];
    setUploading(block.id);
    try {
      const form = new FormData(); form.append("courseId", selected.id); form.append("file", file);
      const response = await fetch("/api/formation/media", { method: "POST", body: form });
      const data = await response.json() as { media?: { storageKey: string; fileName: string; mimeType: string }; error?: string };
      if (!response.ok || !data.media) throw new Error(data.error || "No se pudo subir el material.");
      updateBlock(chapterIndex, lessonIndex, blockIndex, { ...data.media, url: "" }); notify("Material subido. Guarda el borrador para vincularlo a la clase.");
    } catch (error) { notify(error instanceof Error ? error.message : "No se pudo subir el material."); }
    finally { setUploading(""); }
  }

  if (loading) return <div className="empty-state formation-admin-loading"><LoaderCircle className="spin" size={28}/><strong>Preparando el campus…</strong></div>;

  return <div className="formation-admin">
    <div className="formation-heading"><div><p className="section-kicker">Campus compartible</p><h1>Formación</h1><p>Crea el programa, organiza capítulos y publica únicamente cuando esté listo.</p></div><button className="primary-formation-button" onClick={createCourse} disabled={busy}><Plus size={17}/> Nueva formación</button></div>
    <section className="formation-library-strip">{courses.map((course) => <button key={course.id} className={course.id === selected?.id ? "active" : ""} onClick={() => setSelectedId(course.id)}><span className={course.status}><GraduationCap size={18}/></span><div><strong>{course.title}</strong><small>{course.status === "published" ? "Publicada" : "Borrador"} · {totalLessons(course)} clases</small></div></button>)}</section>
    {!selected ? <section className="formation-panel campus-editor-empty"><BookOpen size={32}/><h2>Crea tu primera formación</h2><p>Podrás añadir capítulos, clases, materiales y pruebas.</p><button className="primary-formation-button" onClick={createCourse}><Plus size={16}/> Crear formación</button></section> : <>
      <section className="formation-panel course-editor-hero">
        <div className="course-status-mark"><span className={selected.status}><GraduationCap size={24}/></span><div><small>{selected.status === "published" ? "Visible en el campus" : "Borrador privado"}</small><strong>{totalLessons(selected)} clases · {totalQuestions(selected)} preguntas</strong></div></div>
        <div className="course-editor-actions"><button onClick={shareCourse}><Clipboard size={16}/> Copiar enlace</button>{selected.status === "published" && <a href={`/formacion/${selected.slug}`} target="_blank"><Eye size={16}/> Ver campus</a>}<button className="danger-action" onClick={deleteCourse}><Trash2 size={16}/> Eliminar</button></div>
      </section>
      <section className="formation-panel course-meta-editor">
        <div className="course-editor-section-title"><span><Pencil size={18}/></span><div><p className="section-kicker">Datos generales</p><h2>Identidad del programa</h2></div></div>
        <div className="course-meta-grid"><label><span>Título</span><input value={selected.title} onChange={(event) => patchCourse({ title: event.target.value })}/></label><label><span>Duración total</span><div className="input-suffix"><input type="number" min={1} max={500} value={selected.durationHours} onChange={(event) => patchCourse({ durationHours: Number(event.target.value) })}/><em>horas</em></div></label><label className="wide"><span>Descripción principal</span><textarea value={selected.description} onChange={(event) => patchCourse({ description: event.target.value })}/></label><label className="wide"><span>Dirigido a</span><input value={selected.audience} onChange={(event) => patchCourse({ audience: event.target.value })} placeholder="Ej. Coordinadores, supervisores y terapeutas"/></label></div>
      </section>
      <section className="course-structure-heading"><div><p className="section-kicker">Estructura curricular</p><h2>Capítulos y clases</h2></div><button onClick={() => patchCourse({ content: { chapters: [...selected.content.chapters, blankFormationChapter()] } })}><Plus size={16}/> Agregar capítulo</button></section>
      <div className="course-chapter-list">{selected.content.chapters.map((chapter, chapterIndex) => <section className="formation-panel course-chapter-editor" key={chapter.id}>
        <header><span>{String(chapterIndex + 1).padStart(2, "0")}</span><div><label><small>Título del capítulo</small><input value={chapter.title} onChange={(event) => updateChapter(chapterIndex, { title: event.target.value })}/></label><label><small>Descripción</small><input value={chapter.description} onChange={(event) => updateChapter(chapterIndex, { description: event.target.value })}/></label></div><div className="structure-actions"><button aria-label="Subir capítulo" disabled={chapterIndex === 0} onClick={() => patchCourse({ content: { chapters: move(selected.content.chapters, chapterIndex, -1) } })}><ArrowUp size={15}/></button><button aria-label="Bajar capítulo" disabled={chapterIndex === selected.content.chapters.length - 1} onClick={() => patchCourse({ content: { chapters: move(selected.content.chapters, chapterIndex, 1) } })}><ArrowDown size={15}/></button><button className="danger-action" aria-label="Eliminar capítulo" onClick={() => { if (window.confirm(`¿Eliminar el capítulo “${chapter.title}” y sus clases?`)) patchCourse({ content: { chapters: selected.content.chapters.filter((_, index) => index !== chapterIndex) } }); }}><Trash2 size={15}/></button></div></header>
        <div className="course-lesson-list">{chapter.lessons.map((lesson, lessonIndex) => <details className="course-lesson-editor" key={lesson.id} open={lessonIndex === 0}>
          <summary><span>{lessonIndex + 1}</span><div><strong>{lesson.title || "Clase sin título"}</strong><small>{lesson.durationMinutes} min · {lesson.blocks.length} recursos · {lesson.quiz.questions.length} preguntas</small></div><div className="lesson-summary-actions"><button type="button" aria-label="Subir clase" disabled={lessonIndex === 0} onClick={(event) => { event.preventDefault(); updateChapter(chapterIndex, { lessons: move(chapter.lessons, lessonIndex, -1) }); }}><ArrowUp size={14}/></button><button type="button" aria-label="Bajar clase" disabled={lessonIndex === chapter.lessons.length - 1} onClick={(event) => { event.preventDefault(); updateChapter(chapterIndex, { lessons: move(chapter.lessons, lessonIndex, 1) }); }}><ArrowDown size={14}/></button><button type="button" className="danger-action" aria-label="Eliminar clase" onClick={(event) => { event.preventDefault(); if (window.confirm(`¿Eliminar la clase “${lesson.title}”?`)) updateChapter(chapterIndex, { lessons: chapter.lessons.filter((_, index) => index !== lessonIndex) }); }}><Trash2 size={14}/></button></div></summary>
          <div className="lesson-editor-body">
            <div className="lesson-meta-grid"><label><span>Título de la clase</span><input value={lesson.title} onChange={(event) => updateLesson(chapterIndex, lessonIndex, { title: event.target.value })}/></label><label><span>Duración</span><div className="input-suffix"><input type="number" min={1} max={600} value={lesson.durationMinutes} onChange={(event) => updateLesson(chapterIndex, lessonIndex, { durationMinutes: Number(event.target.value) })}/><em>min</em></div></label><label className="wide"><span>Objetivo específico</span><textarea value={lesson.objective} onChange={(event) => updateLesson(chapterIndex, lessonIndex, { objective: event.target.value })}/></label></div>
            <div className="lesson-block-heading"><div><strong>Contenido de la clase</strong><small>Ordena la explicación exactamente como la verá el estudiante.</small></div><div>{(["paragraph", "video", "image", "pdf"] as FormationBlockType[]).map((type) => <button key={type} onClick={() => updateLesson(chapterIndex, lessonIndex, { blocks: [...lesson.blocks, blankFormationBlock(type)] })}>{type === "paragraph" ? <FileText size={14}/> : type === "video" ? <PlayCircle size={14}/> : type === "image" ? <ImageIcon size={14}/> : <BookOpen size={14}/>} {type === "paragraph" ? "Párrafo" : type === "video" ? "Video" : type === "image" ? "Imagen" : "PDF"}</button>)}</div></div>
            <div className="lesson-block-list">{lesson.blocks.map((block, blockIndex) => <article key={block.id} className={`lesson-block-editor ${block.type}`}><span className="block-type-mark">{block.type === "paragraph" ? <FileText size={17}/> : block.type === "video" ? <PlayCircle size={17}/> : block.type === "image" ? <ImageIcon size={17}/> : <BookOpen size={17}/>}</span><div className="block-fields"><input aria-label="Título opcional del recurso" value={block.title} onChange={(event) => updateBlock(chapterIndex, lessonIndex, blockIndex, { title: event.target.value })} placeholder="Título opcional"/>{block.type === "paragraph" ? <textarea value={block.text} onChange={(event) => updateBlock(chapterIndex, lessonIndex, blockIndex, { text: event.target.value })} placeholder="Escribe aquí el contenido de la clase…"/> : <><input value={block.url} onChange={(event) => updateBlock(chapterIndex, lessonIndex, blockIndex, { url: event.target.value, storageKey: "", fileName: "", mimeType: "" })} placeholder={block.type === "video" ? "Enlace de YouTube, Vimeo o video" : "Enlace externo opcional"}/><label className="block-upload"><Upload size={14}/><span>{uploading === block.id ? "Subiendo…" : block.storageKey ? block.fileName : "Subir archivo"}</span><input type="file" disabled={uploading === block.id} accept={block.type === "image" ? "image/*" : block.type === "video" ? "video/*" : "application/pdf"} onChange={(event) => { uploadBlock(chapterIndex, lessonIndex, blockIndex, event.target.files?.[0]); event.currentTarget.value = ""; }}/></label></>}</div><div className="structure-actions"><button disabled={blockIndex === 0} onClick={() => updateLesson(chapterIndex, lessonIndex, { blocks: move(lesson.blocks, blockIndex, -1) })}><ArrowUp size={14}/></button><button disabled={blockIndex === lesson.blocks.length - 1} onClick={() => updateLesson(chapterIndex, lessonIndex, { blocks: move(lesson.blocks, blockIndex, 1) })}><ArrowDown size={14}/></button><button className="danger-action" onClick={() => updateLesson(chapterIndex, lessonIndex, { blocks: lesson.blocks.filter((_, index) => index !== blockIndex) })}><Trash2 size={14}/></button></div></article>)}</div>
            <div className="quiz-editor"><div className="quiz-editor-heading"><div><span><CheckCircle2 size={18}/></span><div><strong>Test de la clase</strong><small>Las respuestas correctas solo se muestran después de enviar.</small></div></div><label><span>Criterio</span><div className="input-suffix"><input type="number" min={1} max={100} value={lesson.quiz.passingScore} onChange={(event) => updateLesson(chapterIndex, lessonIndex, { quiz: { ...lesson.quiz, passingScore: Number(event.target.value) } })}/><em>%</em></div></label><button onClick={() => updateLesson(chapterIndex, lessonIndex, { quiz: { ...lesson.quiz, questions: [...lesson.quiz.questions, blankFormationQuestion()] } })}><Plus size={15}/> Pregunta</button></div>
              {lesson.quiz.questions.map((question, questionIndex) => <article className="question-editor" key={question.id}><header><span>{questionIndex + 1}</span><input value={question.prompt} onChange={(event) => updateLesson(chapterIndex, lessonIndex, { quiz: { ...lesson.quiz, questions: lesson.quiz.questions.map((item, index) => index === questionIndex ? { ...item, prompt: event.target.value } : item) } })} placeholder="Escribe la pregunta"/><button className="danger-action" onClick={() => updateLesson(chapterIndex, lessonIndex, { quiz: { ...lesson.quiz, questions: lesson.quiz.questions.filter((_, index) => index !== questionIndex) } })}><Trash2 size={14}/></button></header><div className="option-editor-list">{question.options.map((option, optionIndex) => <label key={option.id}><input type="radio" name={`correct-${question.id}`} checked={question.correctOptionId === option.id} onChange={() => updateLesson(chapterIndex, lessonIndex, { quiz: { ...lesson.quiz, questions: lesson.quiz.questions.map((item, index) => index === questionIndex ? { ...item, correctOptionId: option.id } : item) } })}/><input value={option.text} onChange={(event) => updateLesson(chapterIndex, lessonIndex, { quiz: { ...lesson.quiz, questions: lesson.quiz.questions.map((item, index) => index === questionIndex ? { ...item, options: item.options.map((choice, choiceIndex) => choiceIndex === optionIndex ? { ...choice, text: event.target.value } : choice) } : item) } })} placeholder={`Opción ${optionIndex + 1}`}/>{question.options.length > 2 && <button onClick={() => updateLesson(chapterIndex, lessonIndex, { quiz: { ...lesson.quiz, questions: lesson.quiz.questions.map((item, index) => index === questionIndex ? { ...item, options: item.options.filter((_, choiceIndex) => choiceIndex !== optionIndex), correctOptionId: item.correctOptionId === option.id ? item.options.find((_, choiceIndex) => choiceIndex !== optionIndex)?.id || "" : item.correctOptionId } : item) } })}><Trash2 size={13}/></button>}</label>)}</div><button className="add-option" onClick={() => updateLesson(chapterIndex, lessonIndex, { quiz: { ...lesson.quiz, questions: lesson.quiz.questions.map((item, index) => index === questionIndex ? { ...item, options: [...item.options, { id: crypto.randomUUID(), text: "" }] } : item) } })}><Plus size={13}/> Agregar opción</button><textarea value={question.explanation} onChange={(event) => updateLesson(chapterIndex, lessonIndex, { quiz: { ...lesson.quiz, questions: lesson.quiz.questions.map((item, index) => index === questionIndex ? { ...item, explanation: event.target.value } : item) } })} placeholder="Retroalimentación después de responder (opcional)"/></article>)}
            </div>
          </div>
        </details>)}</div>
        <button className="add-lesson-button" onClick={() => updateChapter(chapterIndex, { lessons: [...chapter.lessons, blankFormationLesson()] })}><Plus size={15}/> Agregar clase al capítulo</button>
      </section>)}</div>
      {!selected.content.chapters.length && <section className="formation-panel campus-editor-empty"><BookOpen size={30}/><h2>Comienza por el primer capítulo</h2><button className="primary-formation-button" onClick={() => patchCourse({ content: { chapters: [blankFormationChapter()] } })}><Plus size={16}/> Crear capítulo</button></section>}
      <section className="course-save-bar"><div><strong>{selected.status === "published" ? "Cambios pendientes de guardar" : "Borrador privado"}</strong><small>Publicar valida que cada clase tenga contenido y habilita el enlace compartible.</small></div><button onClick={() => persist("save")} disabled={busy}>{busy ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>} Guardar borrador</button>{selected.status === "published" ? <button className="secondary-formation-button" onClick={() => persist("unpublish")} disabled={busy}>Retirar del campus</button> : <button className="primary-formation-button" onClick={() => persist("publish")} disabled={busy}><Send size={16}/> Publicar</button>}</section>
    </>}
  </div>;
}
