import { eq } from 'drizzle-orm';
import { projects } from '@kenresoft/database';
import type { Database, NewProject, Project } from '@kenresoft/database';

export async function createProject(
  db: Database,
  input: Pick<NewProject, 'name' | 'slug'>,
): Promise<Project> {
  const [project] = await db.insert(projects).values(input).returning();
  return project!;
}

export function listProjects(db: Database): Promise<Project[]> {
  return db.query.projects.findMany();
}

export function getProjectBySlug(db: Database, slug: string): Promise<Project | undefined> {
  return db.query.projects.findFirst({ where: eq(projects.slug, slug) });
}

export function getProjectById(db: Database, id: string): Promise<Project | undefined> {
  return db.query.projects.findFirst({ where: eq(projects.id, id) });
}
