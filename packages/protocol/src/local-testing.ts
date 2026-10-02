import { z } from 'zod';

export const localTestAccountIdSchema = z.enum(['admin1', 'admin2']);
const localTestAccountSchema = z.discriminatedUnion('id', [
  z.strictObject({ id: z.literal('admin1'), name: z.literal('ADMINA') }),
  z.strictObject({ id: z.literal('admin2'), name: z.literal('ADMINB') }),
]);
export const localTestAccountsSchema = z.strictObject({
  enabled: z.boolean(),
  accounts: z.array(localTestAccountSchema).max(2),
});
export const localTestConnectSchema = z.strictObject({ accountId: localTestAccountIdSchema });
export type LocalTestAccountId = z.infer<typeof localTestAccountIdSchema>;
export type LocalTestAccounts = z.infer<typeof localTestAccountsSchema>;
