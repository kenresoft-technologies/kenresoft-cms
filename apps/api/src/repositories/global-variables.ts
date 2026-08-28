import { asc, eq, globalVariables } from '@kenresoft/database';
import type { Database, GlobalVariable, NewGlobalVariable } from '@kenresoft/database';

export function listGlobalVariables(db: Database): Promise<GlobalVariable[]> {
  return db.query.globalVariables.findMany({ orderBy: asc(globalVariables.key) });
}

export function getGlobalVariableById(db: Database, id: string): Promise<GlobalVariable | undefined> {
  return db.query.globalVariables.findFirst({ where: eq(globalVariables.id, id) });
}

export function getGlobalVariableByKey(db: Database, key: string): Promise<GlobalVariable | undefined> {
  return db.query.globalVariables.findFirst({ where: eq(globalVariables.key, key) });
}

export async function createGlobalVariable(
  db: Database,
  input: Pick<NewGlobalVariable, 'key' | 'value'>,
): Promise<GlobalVariable> {
  const [row] = await db.insert(globalVariables).values(input).returning();
  return row!;
}

export async function updateGlobalVariable(
  db: Database,
  id: string,
  value: string,
): Promise<GlobalVariable | undefined> {
  const [row] = await db.update(globalVariables).set({ value }).where(eq(globalVariables.id, id)).returning();
  return row;
}

export async function deleteGlobalVariable(db: Database, id: string): Promise<void> {
  await db.delete(globalVariables).where(eq(globalVariables.id, id));
}
