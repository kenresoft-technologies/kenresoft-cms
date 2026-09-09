import { asc, eq, and, ne, pluginCommerceCustomerAddresses } from '@kenresoft-cms/database';
import type { Database, NewPluginCommerceCustomerAddress, PluginCommerceCustomerAddress } from '@kenresoft-cms/database';

type AddressWritable = Pick<
  NewPluginCommerceCustomerAddress,
  'label' | 'recipientName' | 'line1' | 'line2' | 'city' | 'region' | 'postalCode' | 'country' | 'phone' | 'isDefault'
>;

export function listAddressesForCustomer(db: Database, customerId: string): Promise<PluginCommerceCustomerAddress[]> {
  return db.query.pluginCommerceCustomerAddresses.findMany({
    where: eq(pluginCommerceCustomerAddresses.customerId, customerId),
    orderBy: asc(pluginCommerceCustomerAddresses.createdAt),
  });
}

export function getAddressById(db: Database, id: string): Promise<PluginCommerceCustomerAddress | undefined> {
  return db.query.pluginCommerceCustomerAddresses.findFirst({ where: eq(pluginCommerceCustomerAddresses.id, id) });
}

// If the new/updated address is set as default, every other address for this customer has its
// own isDefault cleared first — at most one default address per customer, enforced here in
// application code (not a DB constraint, matching this codebase's own upsert-in-code precedent).
async function clearOtherDefaults(db: Database, customerId: string, exceptId?: string): Promise<void> {
  await db
    .update(pluginCommerceCustomerAddresses)
    .set({ isDefault: false })
    .where(
      exceptId
        ? and(eq(pluginCommerceCustomerAddresses.customerId, customerId), ne(pluginCommerceCustomerAddresses.id, exceptId))
        : eq(pluginCommerceCustomerAddresses.customerId, customerId),
    );
}

export async function createAddress(
  db: Database,
  customerId: string,
  input: AddressWritable,
): Promise<PluginCommerceCustomerAddress> {
  if (input.isDefault) await clearOtherDefaults(db, customerId);
  const [row] = await db
    .insert(pluginCommerceCustomerAddresses)
    .values({ ...input, customerId })
    .returning();
  return row!;
}

type AddressPatch = { [K in keyof AddressWritable]?: AddressWritable[K] | undefined };

export async function updateAddress(
  db: Database,
  id: string,
  customerId: string,
  input: AddressPatch,
): Promise<PluginCommerceCustomerAddress | undefined> {
  if (input.isDefault) await clearOtherDefaults(db, customerId, id);
  const [row] = await db
    .update(pluginCommerceCustomerAddresses)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(pluginCommerceCustomerAddresses.id, id))
    .returning();
  return row;
}

export async function deleteAddress(db: Database, id: string): Promise<boolean> {
  const [deleted] = await db
    .delete(pluginCommerceCustomerAddresses)
    .where(eq(pluginCommerceCustomerAddresses.id, id))
    .returning({ id: pluginCommerceCustomerAddresses.id });
  return Boolean(deleted);
}
