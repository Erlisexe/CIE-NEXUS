import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb } from "../../../db";
import { formationCourses } from "../../../db/schema";
import { parseFormationCourse } from "../../../lib/formation";
import FormationCampus from "../../components/formation-campus";

export const dynamic = "force-dynamic";

export default async function CoursePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await getDb();
  const [row] = await db.select().from(formationCourses).where(eq(formationCourses.slug, slug)).limit(1);
  if (!row || row.status !== "published") notFound();
  const course = parseFormationCourse(row as unknown as Record<string, unknown>);
  const publicCourse = {
    ...course,
    content: { chapters: course.content.chapters.map((chapter) => ({ ...chapter, lessons: chapter.lessons.map((lesson) => ({ ...lesson, quiz: { ...lesson.quiz, questions: lesson.quiz.questions.map((question) => ({ ...question, correctOptionId: "", explanation: "" })) } })) })) },
  };
  return <FormationCampus course={publicCourse}/>;
}
