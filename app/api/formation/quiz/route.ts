import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { formationCourses } from "../../../../db/schema";
import { normalizeFormationContent } from "../../../../lib/formation";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const courseId = typeof body.courseId === "string" ? body.courseId : "";
    const lessonId = typeof body.lessonId === "string" ? body.lessonId : "";
    const answers = body.answers && typeof body.answers === "object" ? body.answers as Record<string, string> : {};
    const db = await getDb();
    const [course] = await db.select().from(formationCourses).where(eq(formationCourses.id, courseId)).limit(1);
    if (!course || course.status !== "published") return Response.json({ error: "La formación no está disponible." }, { status: 404 });
    const content = normalizeFormationContent(JSON.parse(course.content));
    const lesson = content.chapters.flatMap((chapter) => chapter.lessons).find((item) => item.id === lessonId);
    if (!lesson || !lesson.quiz.questions.length) return Response.json({ error: "Esta clase no tiene una evaluación disponible." }, { status: 404 });
    const results = lesson.quiz.questions.map((question) => ({
      questionId: question.id,
      correct: answers[question.id] === question.correctOptionId,
      correctOptionId: question.correctOptionId,
      explanation: question.explanation,
    }));
    const correct = results.filter((result) => result.correct).length;
    const score = Math.round((correct / results.length) * 100);
    return Response.json({ score, correct, total: results.length, passed: score >= lesson.quiz.passingScore, passingScore: lesson.quiz.passingScore, results });
  } catch { return Response.json({ error: "No se pudo calificar la evaluación." }, { status: 500 }); }
}
