import { z } from "zod";

const LarkAccountSchemaBase = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    webhookUrl: z.string().url().optional(),
    secret: z.string().optional(),
    timeoutSeconds: z.number().int().positive().optional(),
    textChunkLimit: z.number().int().positive().optional(),
  })
  .strict();

export const LarkConfigSchema = LarkAccountSchemaBase.extend({
  defaultAccountId: z.string().optional(),
  accounts: z.record(z.string(), LarkAccountSchemaBase.optional()).optional(),
}).strict();
