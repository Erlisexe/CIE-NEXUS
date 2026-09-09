import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { cieSites } from "../db/schema";

export type CieSite = typeof cieSites.$inferSelect;

export async function listCieSites(options?: { includeInactive?: boolean }) {
  const db = await getDb();
  const query = db.select().from(cieSites);
  return options?.includeInactive
    ? query.orderBy(asc(cieSites.name))
    : query.where(eq(cieSites.status, "active")).orderBy(asc(cieSites.name));
}

export async function activeSiteNames() {
  return (await listCieSites()).map((site) => site.name);
}

export async function isActiveSite(name: string) {
  if (!name) return false;
  const db = await getDb();
  const [site] = await db.select({ id: cieSites.id }).from(cieSites)
    .where(and(eq(cieSites.name, name), eq(cieSites.status, "active"))).limit(1);
  return Boolean(site);
}
