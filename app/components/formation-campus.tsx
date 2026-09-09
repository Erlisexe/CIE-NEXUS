"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, Clock3, FileText, GraduationCap, Menu, PlayCircle, RotateCcw, X, XCircle } from "lucide-react";
import type { FormationBlock, FormationCourse } from "../../lib/formation";

type QuizResult = { score: number; correct: number; total: number; passed: boolean; passingScore: number; results: Array<{ questionId: string; correct: boolean; correctOptionId: string; explanation: string }> };

function mediaUrl(courseId: string, key: string) {
  return `/api/formation/media?courseId=${encodeURIComponent(courseId)}&key=${encodeURIComponent(key)}`;
}

function videoEmbedUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname.includes("youtube.com")) {
      const id = url.searchParams.get("v") || url.pathname.split("/").filter(Boolean).pop();
      return id ? `https://www.youtube.com/embed/${id}` : "";
    }
    if (url.hostname === "youtu.be") return `https://www.youtube.com/embed/${url.pathname.slice(1)}`;
    if (url.hostname.includes("vimeo.com")) return `https://player.vimeo.com/video/${url.pathname.split("/").filter(Boolean).pop()}`;
  } catch { return ""; }
  return "";
}

function LessonBlock({ block, courseId }: { block: FormationBlock; courseId: string }) {
  const source = block.storageKey ? mediaUrl(courseId, block.storageKey) : block.url;
  if (block.type === "paragraph") return <section className="lesson-copy-block">{block.title && <h2>{block.title}</h2>}<p>{block.text}</p></section>;
  if (block.type === "image") return <figure className="lesson-image-block"><img src={source} alt={block.title || block.fileName || "Material visual de la clase"}/>{block.title && <figcaption>{block.title}</figcaption>}</figure>;
  if (block.type === "pdf") return <a className="lesson-file-block" href={source} target="_blank" rel="noreferrer"><span><FileText size={23}/></span><div><strong>{block.title || block.fileName || "Material PDF"}</strong><small>Abrir material en una pestaña nueva</small></div><ArrowRight size={18}/></a>;
  const embed = !block.storageKey ? videoEmbedUrl(block.url) : "";
  return <section className="lesson-video-block">{block.title && <h2>{block.title}</h2>}{embed ? <iframe src={embed} title={block.title || "Video de la clase"} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen/> : <video src={source} controls preload="metadata"/>}</section>;
}

export default function FormationCampus({ course }: { course: FormationCourse }) {
  const lessons = useMemo(() => course.content.chapters.flatMap((chapter, chapterIndex) => chapter.lessons.map((lesson, lessonIndex) => ({ chapter, chapterIndex, lesson, lessonIndex }))), [course]);
  const [activeLessonId, setActiveLessonId] = useState(lessons[0]?.lesson.id || "");
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => Object.fromEntries(course.content.chapters.map((chapter, index) => [chapter.id, index === 0])));
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const activeIndex = lessons.findIndex((item) => item.lesson.id === activeLessonId);
  const active = lessons[activeIndex] || lessons[0];
  if (!active) return <main className="campus-public-empty"><GraduationCap size={34}/><h1>Esta formación aún no contiene clases.</h1></main>;

  function openLesson(id: string) {
    setActiveLessonId(id); setAnswers({}); setResult(null); setMenuOpen(false); window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitQuiz() {
    if (Object.keys(answers).length < active.lesson.quiz.questions.length) return;
    setSubmitting(true);
    try {
      const response = await fetch("/api/formation/quiz", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId: course.id, lessonId: active.lesson.id, answers }) });
      const data = await response.json() as QuizResult & { error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo calificar.");
      setResult(data);
    } finally { setSubmitting(false); }
  }

  return <div className="campus-shell">
    {menuOpen && <button className="campus-scrim" aria-label="Cerrar índice" onClick={() => setMenuOpen(false)}/>} 
    <aside className={`campus-sidebar ${menuOpen ? "open" : ""}`}>
      <div className="campus-sidebar-head"><Link href="/formacion" className="campus-public-brand"><span><GraduationCap size={21}/></span><div><strong>CIE Nexus</strong><small>Formación</small></div></Link><button aria-label="Cerrar índice" onClick={() => setMenuOpen(false)}><X size={19}/></button></div>
      <div className="campus-course-summary"><small>Formación activa</small><strong>{course.title}</strong><span><Clock3 size={14}/>{course.durationHours} horas · {lessons.length} clases</span></div>
      <nav aria-label="Capítulos y clases" className="campus-outline">{course.content.chapters.map((chapter, chapterIndex) => <section key={chapter.id}>
        <button className="campus-chapter-toggle" aria-expanded={Boolean(expanded[chapter.id])} onClick={() => setExpanded((current) => ({ ...current, [chapter.id]: !current[chapter.id] }))}><span>{String(chapterIndex + 1).padStart(2, "0")}</span><strong>{chapter.title}</strong><ChevronDown size={16}/></button>
        {expanded[chapter.id] && <div className="campus-lesson-list">{chapter.lessons.map((lesson, lessonIndex) => <button className={lesson.id === active.lesson.id ? "active" : ""} key={lesson.id} onClick={() => openLesson(lesson.id)}><span>{lessonIndex + 1}</span><div><strong>{lesson.title}</strong><small>{lesson.durationMinutes} min{lesson.quiz.questions.length ? ` · Test ${lesson.quiz.questions.length}` : ""}</small></div></button>)}</div>}
      </section>)}</nav>
    </aside>
    <main className="campus-workspace">
      <header className="campus-topbar"><button className="campus-menu-button" onClick={() => setMenuOpen(true)}><Menu size={19}/><span>Índice</span></button><div><span>Capítulo {active.chapterIndex + 1}</span><strong>{active.chapter.title}</strong></div><Link href="/formacion"><ArrowLeft size={16}/> Programas</Link></header>
      <article className="campus-lesson">
        <header className="campus-lesson-hero"><div><p className="section-kicker">Clase {active.lessonIndex + 1} · {active.lesson.durationMinutes} minutos</p><h1>{active.lesson.title}</h1>{active.lesson.objective && <p>{active.lesson.objective}</p>}</div><span><PlayCircle size={28}/></span></header>
        <div className="campus-lesson-content">{active.lesson.blocks.map((block) => <LessonBlock block={block} courseId={course.id} key={block.id}/>)}</div>
        {active.lesson.quiz.questions.length > 0 && <section className="campus-quiz">
          <header><span><Check size={22}/></span><div><p className="section-kicker">Comprobación de aprendizaje</p><h2>Test de la clase</h2><p>{active.lesson.quiz.questions.length} preguntas · criterio de aprobación {active.lesson.quiz.passingScore}%</p></div></header>
          <div className="campus-question-list">{active.lesson.quiz.questions.map((question, questionIndex) => {
            const questionResult = result?.results.find((item) => item.questionId === question.id);
            return <fieldset key={question.id} className={questionResult ? questionResult.correct ? "correct" : "incorrect" : ""}><legend><span>{questionIndex + 1}</span>{question.prompt}</legend><div>{question.options.map((option) => <label key={option.id} className={`${answers[question.id] === option.id ? "selected" : ""} ${questionResult?.correctOptionId === option.id ? "answer-key" : ""}`}><input type="radio" name={question.id} value={option.id} disabled={Boolean(result)} checked={answers[question.id] === option.id} onChange={() => setAnswers((current) => ({ ...current, [question.id]: option.id }))}/><span>{option.text}</span>{questionResult?.correctOptionId === option.id && <CheckCircle2 size={16}/>}</label>)}</div>{questionResult?.explanation && <p className="question-feedback">{questionResult.explanation}</p>}</fieldset>;
          })}</div>
          {result ? <div className={`quiz-result ${result.passed ? "passed" : "retry"}`}><span>{result.passed ? <CheckCircle2 size={28}/> : <XCircle size={28}/>}</span><div><strong>{result.passed ? "Evaluación aprobada" : "Conviene repasar la clase"}</strong><p>{result.correct} de {result.total} respuestas correctas · {result.score}%</p></div><button onClick={() => { setAnswers({}); setResult(null); }}><RotateCcw size={16}/> Intentar de nuevo</button></div> : <button className="campus-submit-quiz" disabled={submitting || Object.keys(answers).length < active.lesson.quiz.questions.length} onClick={submitQuiz}>{submitting ? "Calificando…" : "Enviar respuestas"}<ArrowRight size={17}/></button>}
        </section>}
        <footer className="campus-lesson-nav"><button disabled={activeIndex <= 0} onClick={() => openLesson(lessons[activeIndex - 1].lesson.id)}><ArrowLeft size={17}/> Clase anterior</button><span>{activeIndex + 1} de {lessons.length}</span><button disabled={activeIndex >= lessons.length - 1} onClick={() => openLesson(lessons[activeIndex + 1].lesson.id)}>Siguiente clase <ArrowRight size={17}/></button></footer>
      </article>
    </main>
  </div>;
}
