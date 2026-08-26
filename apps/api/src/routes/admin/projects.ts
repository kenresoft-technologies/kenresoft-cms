import { Hono } from 'hono';

import { getDb } from '../../lib/db';
import { parseJsonBody } from '../../lib/validate';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';
import { createProject, listProjects } from '../../repositories/projects';
import { createProjectSchema } from '../../validators/projects';

export const projectsRoute = new Hono<{ Bindings: Bindings; Variables: AuthedVariables }>();

projectsRoute.get('/', async (c) => {
  const db = getDb(c);
  return c.json(await listProjects(db));
});

projectsRoute.post('/', async (c) => {
  const parsed = await parseJsonBody(c, createProjectSchema);
  if ('error' in parsed) return parsed.error;

  const db = getDb(c);
  const project = await createProject(db, parsed.data);
  return c.json(project, 201);
});
