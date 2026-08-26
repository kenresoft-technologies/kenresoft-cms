import { Hono } from 'hono';

import { getDb } from '../../lib/db';
import { parseJsonBody } from '../../lib/validate';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';
import { requireRole } from '../../middleware/require-role';
import { createProject, getProjectById, listProjects } from '../../repositories/projects';
import { createProjectSchema } from '../../validators/projects';

export const projectsRoute = new Hono<{ Bindings: Bindings; Variables: AuthedVariables }>();

projectsRoute.get('/', async (c) => {
  const db = getDb(c);
  return c.json(await listProjects(db));
});

projectsRoute.get('/:id', async (c) => {
  const db = getDb(c);
  const project = await getProjectById(db, c.req.param('id'));
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }
  return c.json(project);
});

// Projects are the tenant boundary (§11) — creating one is an owner-level action, not
// something every editor can do.
projectsRoute.post('/', requireRole('owner'), async (c) => {
  const parsed = await parseJsonBody(c, createProjectSchema);
  if ('error' in parsed) return parsed.error;

  const db = getDb(c);
  const project = await createProject(db, parsed.data);
  return c.json(project, 201);
});
