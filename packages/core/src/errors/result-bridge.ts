import type { Result } from '../utils/result.js';
import { FiusValidationError } from './FiusValidationError.js';
import type { Logger } from '../logger/v2/types.js';


export function ensureOk<T, C>(result: Result<T, C>, logger: Logger): T {
    if (result.ok) {
        return result.data;
    }

    const issueMessages = result.issues.map((i) => i.message).join('; ');
    logger.error(`ensureOk: validation failed - ${issueMessages}`);
    throw new FiusValidationError(result.issues);
}
