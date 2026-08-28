import { createRoute } from '@hono/zod-openapi';
import {
  createGlobalVariableSchema,
  globalVariableSchema,
  idParamSchema,
  updateGlobalVariableSchema,
} from '@kenresoft/contracts';
import type { GlobalVariable } from '@kenresoft/contracts';
import { z } from 'zod';

import { getDb } from '../../lib/db';
import { createOpenApiApp } from '../../lib/openapi';
import { invalidatePublicGlobalVariablesCache } from '../../lib/public-cache';
import { requireRole } from '../../middleware/require-role';
import {
  createGlobalVariable,
  deleteGlobalVariable,
  getGlobalVariableByKey,
  getGlobalVariableById,
  listGlobalVariables,
  updateGlobalVariable,
} from '../../repositories/global-variables';
import type { Bindings } from '../../lib/env';
import type { AuthedVariables } from '../../middleware/require-session';
import type { GlobalVariable as DbGlobalVariable } from '@kenresoft/database';

export const globalVariablesRoute = createOpenApiApp<{ Bindings: Bindings; Variables: AuthedVariables }>();

const notFoundSchema = z.object({ error: z.string() });

function toGlobalVariable(row: DbGlobalVariable): GlobalVariable {
  return {
    id: row.id,
    key: row.key,
    value: row.value,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

globalVariablesRoute.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Global variables'],
    summary: 'List every global variable',
    responses: {
      200: {
        description: 'Every global variable, alphabetical by key.',
        content: { 'application/json': { schema: z.array(globalVariableSchema) } },
      },
    },
  }),
  async (c) => {
    const db = getDb(c);
    return c.json((await listGlobalVariables(db)).map(toGlobalVariable), 200);
  },
);

// Owner-only — a new key is a structural addition (any Astro/frontend page templated against
// it needs to know it exists), same tier as creating a content type or form.
globalVariablesRoute.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Global variables'],
    summary: 'Create a global variable (owner only)',
    middleware: requireRole('owner'),
    request: {
      body: { content: { 'application/json': { schema: createGlobalVariableSchema } } },
    },
    responses: {
      201: {
        description: 'The created global variable.',
        content: { 'application/json': { schema: globalVariableSchema } },
      },
      400: {
        description: 'A variable with that key already exists.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const input = c.req.valid('json');
    const db = getDb(c);

    const existing = await getGlobalVariableByKey(db, input.key);
    if (existing) {
      return c.json({ error: 'A variable with that key already exists' }, 400);
    }

    const created = await createGlobalVariable(db, input);
    c.executionCtx.waitUntil(invalidatePublicGlobalVariablesCache());
    return c.json(toGlobalVariable(created), 201);
  },
);

// No role gate — updating an existing variable's value (a phone number, an address) is
// day-to-day editorial work, not a structural change; the key itself (what a frontend
// actually references) is immutable once created, same reasoning as not allowing this route
// to rename the key out from under any consumer relying on it.
globalVariablesRoute.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Global variables'],
    summary: "Update a global variable's value",
    request: {
      params: idParamSchema,
      body: { content: { 'application/json': { schema: updateGlobalVariableSchema } } },
    },
    responses: {
      200: {
        description: 'The updated global variable.',
        content: { 'application/json': { schema: globalVariableSchema } },
      },
      404: {
        description: 'No global variable with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const existing = await getGlobalVariableById(db, id);
    if (!existing) {
      return c.json({ error: 'Global variable not found' }, 404);
    }

    const { value } = c.req.valid('json');
    const updated = await updateGlobalVariable(db, id, value);
    c.executionCtx.waitUntil(invalidatePublicGlobalVariablesCache());
    return c.json(toGlobalVariable(updated!), 200);
  },
);

globalVariablesRoute.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Global variables'],
    summary: 'Delete a global variable (owner only)',
    middleware: requireRole('owner'),
    request: { params: idParamSchema },
    responses: {
      204: { description: 'The global variable was deleted.' },
      404: {
        description: 'No global variable with that id.',
        content: { 'application/json': { schema: notFoundSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = getDb(c);
    const existing = await getGlobalVariableById(db, id);
    if (!existing) {
      return c.json({ error: 'Global variable not found' }, 404);
    }

    await deleteGlobalVariable(db, id);
    c.executionCtx.waitUntil(invalidatePublicGlobalVariablesCache());
    return c.body(null, 204);
  },
);
