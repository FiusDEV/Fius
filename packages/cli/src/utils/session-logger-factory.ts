import path from 'node:path';
import {
    FiusLogComponent,
    FiusLogger,
    FileTransport,
    type SessionLoggerFactory,
} from '@fius/core';
import { getFiusPath } from '@fius/agent-management';

export function createFileSessionLoggerFactory(): SessionLoggerFactory {
    return ({ baseLogger, agentId, sessionId }) => {
        const safeSessionId = sessionId.replace(/[^a-zA-Z0-9._-]/g, '_');
        const logFilePath = getFiusPath('logs', path.join(agentId, `${safeSessionId}.log`));

        const fileTransport = new FileTransport({ path: logFilePath });

        if (baseLogger instanceof FiusLogger) {
            return baseLogger.createScopedLogger({
                component: FiusLogComponent.SESSION,
                agentId,
                sessionId,
                transports: [fileTransport],
            });
        }

        return new FiusLogger({
            level: baseLogger.getLevel(),
            agentId,
            sessionId,
            component: FiusLogComponent.SESSION,
            transports: [fileTransport],
        });
    };
}
