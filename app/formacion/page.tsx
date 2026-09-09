import Link from "next/link";
import { ArrowRight, BookOpen, Clock3, GraduationCap, Layers3 } from "lucide-react";
import { desc, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { formationCourses } from "../../db/schema";
import { parseFormationCourse } from "../../lib/formation";

export const dynamic = "force-dynamic";

export default async function FormationLanding() {
  let courses: ReturnType<typeof parseFormationCourse>[] = [];
  try {
    const db = await getDb();
    const rows = await db.select().from(formationCourses).where(eq(formationCourses.status, "published")).orderBy(desc(formationCourses.publishedAt));
    courses = rows.map((row) => parseFormationCourse(row as unknown as Record<string, unknown>));
  } catch { courses = []; }

  return <main className="campus-landing">
    <header className="campus-public-header"><Link href="/formacion" className="campus-public-brand"><span><GraduationCap size={22}/></span><div><strong>CIE Nexus</strong><small>Formación</small></div></Link><span className="campus-access-chip">Acceso formativo</span></header>
    <section className="campus-hero">
      <div><p className="section-kicker">Formación profesional</p><h1>Aprender ABA con una ruta clara y aplicable</h1><p>Clases organizadas por capítulos, materiales de apoyo y evaluaciones breves para comprobar cada aprendizaje.</p></div>
      <div className="campus-hero-mark"><BookOpen size={42}/><strong>45 h</strong><span>de formación</span></div>
    </section>
    <section className="campus-catalog">
      <div className="campus-section-title"><div><p className="section-kicker">Programas disponibles</p><h2>Formaciones publicadas</h2></div><span>{courses.length} programa{courses.length === 1 ? "" : "s"}</span></div>
      {courses.length ? <div className="campus-course-grid">{courses.map((course) => {
        const lessons = course.content.chapters.reduce((total, chapter) => total + chapter.lessons.length, 0);
        return <Link href={`/formacion/${course.slug}`} className="campus-course-card" key={course.id}>
          <span className="campus-course-icon"><GraduationCap size={25}/></span>
          <div className="campus-course-copy"><small>Programa formativo</small><h2>{course.title}</h2><p>{course.description}</p></div>
          <div className="campus-course-meta"><span><Clock3 size={15}/>{course.durationHours} horas</span><span><Layers3 size={15}/>{course.content.chapters.length} capítulos</span><span><BookOpen size={15}/>{lessons} clases</span></div>
          <strong className="campus-course-open">Comenzar formación <ArrowRight size={16}/></strong>
        </Link>;
      })}</div> : <div className="campus-public-empty"><GraduationCap size={34}/><h2>La próxima formación está en preparación</h2><p>Cuando el programa sea publicado, aparecerá aquí con todos sus capítulos y materiales.</p></div>}
    </section>
  </main>;
}
