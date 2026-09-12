import { desc, eq, reusableBlocks } from '@kenresoft-cms/database';
import type { Database, NewReusableBlock, ReusableBlock } from '@kenresoft-cms/database';

type ReusableBlockWriteInput = {
  name?: NewReusableBlock['name'] | undefined;
  type?: NewReusableBlock['type'] | undefined;
  config?: NewReusableBlock['config'] | undefined;
};

export async function createReusableBlock(
  db: Database,
  input: Pick<NewReusableBlock, 'name' | 'type' | 'config'>,
): Promise<ReusableBlock> {
  const [block] = await db.insert(reusableBlocks).values(input).returning();
  return block!;
}

export function listReusableBlocks(db: Database): Promise<ReusableBlock[]> {
  return db.query.reusableBlocks.findMany({ orderBy: desc(reusableBlocks.updatedAt) });
}

export function getReusableBlockById(db: Database, id: string): Promise<ReusableBlock | undefined> {
  return db.query.reusableBlocks.findFirst({ where: eq(reusableBlocks.id, id) });
}

export async function updateReusableBlock(
  db: Database,
  id: string,
  patch: ReusableBlockWriteInput,
): Promise<ReusableBlock | undefined> {
  const [block] = await db
    .update(reusableBlocks)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(reusableBlocks.id, id))
    .returning();
  return block;
}

export async function deleteReusableBlock(db: Database, id: string): Promise<boolean> {
  const [deleted] = await db.delete(reusableBlocks).where(eq(reusableBlocks.id, id)).returning({ id: reusableBlocks.id });
  return Boolean(deleted);
}
