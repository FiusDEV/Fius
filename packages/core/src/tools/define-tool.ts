import type { ZodTypeAny } from 'zod';
import type { Tool } from './types.js';


export function defineTool<const TSchema extends ZodTypeAny>(tool: Tool<TSchema>): Tool<TSchema> {
    return tool;
}
