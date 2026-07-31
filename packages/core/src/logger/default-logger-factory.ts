import { z } from 'zod';
import { createLogger } from './factory.js';
import { LoggerConfigSchema } from './v2/schemas.js';
import type { Logger } from './v2/types.js';

export const DefaultLoggerFactoryConfigSchema = z
    .object({
        agentId: z.string(),
        config: LoggerConfigSchema,
    })
    .strict();

export type DefaultLoggerFactoryConfig = z.output<typeof DefaultLoggerFactoryConfigSchema>;

export const defaultLoggerFactory = {
    configSchema: DefaultLoggerFactoryConfigSchema,
    create: (input: DefaultLoggerFactoryConfig): Logger => {
        return createLogger({ agentId: input.agentId, config: input.config });
    },
};
