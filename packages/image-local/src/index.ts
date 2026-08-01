import {
    type FiusImage,
    type HookFactory,
    type CompactionFactory,
    NoOpCompactionConfigSchema,
    type NoOpCompactionConfig,
    ReactiveOverflowCompactionConfigSchema,
    type ReactiveOverflowCompactionConfig,
} from '@fiusdev/agent-config';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
    ContentPolicyHook,
    BackendFiusStores,
    DatabaseBackedApprovalStore,
    DatabaseBackedArtifactStore,
    DatabaseBackedCustomPromptStore,
    DatabaseBackedMemoryStore,
    DatabaseBackedRuntimeEventStore,
    DatabaseBackedSessionMessageQueueStore,
    DatabaseBackedSessionStore,
    DatabaseBackedToolExecutionStore,
    DatabaseBackedToolPreferenceStore,
    DatabaseBackedToolStateStore,
    DatabaseBackedWorkspaceStore,
    SESSION_FOLLOW_UP_QUEUE_KEY_PREFIX,
    SESSION_STEER_QUEUE_KEY_PREFIX,
    DatabaseConversationStore,
    ResponseSanitizerHook,
    defaultLoggerFactory,
    NoOpCompactionStrategy,
    ReactiveOverflowCompactionStrategy,
    type Logger,
} from '@fiusdev/core';
import {
    StorageSchema,
    type ValidatedStorageConfig,
    LocalBlobStoreSchema,
    InMemoryBlobStoreSchema,
    SqliteDatabaseSchema,
    PostgresDatabaseSchema,
    InMemoryDatabaseSchema,
    RedisCacheSchema,
    InMemoryCacheSchema,
    LocalBlobStore,
    MemoryBlobStore,
    SQLiteStore,
    PostgresStore,
    MemoryDatabaseStore,
    RedisStore,
    MemoryCacheStore,
} from '@fiusdev/storage';
import { builtinToolsFactory } from '@fiusdev/tools-builtins';
import { fileSystemToolsFactory } from '@fiusdev/tools-filesystem';
import { processToolsFactory } from '@fiusdev/tools-process';
import { todoToolsFactory } from '@fiusdev/tools-todo';
import { planToolsFactory } from '@fiusdev/tools-plan';
import { schedulerToolsFactory } from '@fiusdev/tools-scheduler';
import { lifecycleToolsFactory } from '@fiusdev/tools-lifecycle';
import {
    agentSpawnerToolsFactory,
    createLocalSkillSources,
    creatorToolsFactory,
    getFiusPackageRoot,
} from '@fiusdev/agent-management';
import { LocalWorkspaceHandleProvider } from './local-workspace-handle-provider.js';

function readPackageJson(packageJsonPath: string): { name?: string; version?: string } | null {
    if (!existsSync(packageJsonPath)) {
        return null;
    }

    try {
        return JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
            name?: string;
            version?: string;
        };
    } catch {
        return null;
    }
}

function resolveModuleDir(): string | undefined {
    const importMetaUrl = typeof import.meta !== 'undefined' ? import.meta.url : undefined;
    if (importMetaUrl) {
        return path.dirname(fileURLToPath(importMetaUrl));
    }

    const filenameFromGlobal = (globalThis as { __filename?: unknown }).__filename;
    if (typeof filenameFromGlobal === 'string' && filenameFromGlobal.length > 0) {
        return path.dirname(filenameFromGlobal);
    }

    return undefined;
}

function resolveImageMetadata(defaultName: string): { name: string; version: string } {
    const moduleDir = resolveModuleDir();
    if (moduleDir) {
        const localPackageJson = readPackageJson(path.resolve(moduleDir, '..', 'package.json'));
        if (localPackageJson) {
            return {
                name: localPackageJson.name ?? defaultName,
                version: localPackageJson.version ?? '0.0.0',
            };
        }
    }

    const packageRoot = getFiusPackageRoot();
    if (packageRoot) {
        const bundledPackageJson = readPackageJson(path.join(packageRoot, 'package.json'));
        if (bundledPackageJson) {
            return {
                name: defaultName,
                version: bundledPackageJson.version ?? '0.0.0',
            };
        }
    }

    return {
        name: defaultName,
        version: process.env.FIUS_CLI_VERSION || '0.0.0',
    };
}

const imageMetadata = resolveImageMetadata('@fiusdev/image-local');

const contentPolicyConfigSchema = z
    .object({
        type: z.literal('content-policy'),
        maxInputChars: z.number().int().positive().optional(),
        redactEmails: z.boolean().optional(),
        redactApiKeys: z.boolean().optional(),
    })
    .strict();

const responseSanitizerConfigSchema = z
    .object({
        type: z.literal('response-sanitizer'),
        redactEmails: z.boolean().optional(),
        redactApiKeys: z.boolean().optional(),
        maxResponseLength: z.number().int().positive().optional(),
    })
    .strict();

const contentPolicyFactory: HookFactory<z.output<typeof contentPolicyConfigSchema>> = {
    configSchema: contentPolicyConfigSchema,
    create: (_config) => new ContentPolicyHook(),
};

const responseSanitizerFactory: HookFactory<z.output<typeof responseSanitizerConfigSchema>> = {
    configSchema: responseSanitizerConfigSchema,
    create: (_config) => new ResponseSanitizerHook(),
};

const noopCompactionFactory: CompactionFactory<NoOpCompactionConfig> = {
    configSchema: NoOpCompactionConfigSchema,
    create: (config) =>
        new NoOpCompactionStrategy({
            enabled: config.enabled,
            maxContextTokens: config.maxContextTokens,
            thresholdPercent: config.thresholdPercent,
        }),
};

const reactiveOverflowCompactionFactory: CompactionFactory<ReactiveOverflowCompactionConfig> = {
    configSchema: ReactiveOverflowCompactionConfigSchema,
    create: (config) =>
        new ReactiveOverflowCompactionStrategy({
            enabled: config.enabled,
            maxContextTokens: config.maxContextTokens,
            thresholdPercent: config.thresholdPercent,
            strategy: {
                preserveLastNTurns: config.preserveLastNTurns,
                maxSummaryTokens: config.maxSummaryTokens,
                ...(config.summaryPrompt !== undefined && { summaryPrompt: config.summaryPrompt }),
            },
        }),
};

async function createLocalStores(config: ValidatedStorageConfig, logger: Logger) {
    let blobStore;
    if (config.blob.type === 'local') {
        blobStore = new LocalBlobStore(LocalBlobStoreSchema.parse(config.blob), logger);
    } else {
        const memoryBlobConfig = InMemoryBlobStoreSchema.parse(config.blob);
        blobStore = new MemoryBlobStore(
            {
                maxBlobSize: memoryBlobConfig.maxBlobSize,
                maxTotalSize: memoryBlobConfig.maxTotalSize,
            },
            logger
        );
    }

    let database;
    if (config.database.type === 'sqlite') {
        database = new SQLiteStore(SqliteDatabaseSchema.parse(config.database), logger);
    } else if (config.database.type === 'postgres') {
        database = new PostgresStore(PostgresDatabaseSchema.parse(config.database), logger);
    } else {
        InMemoryDatabaseSchema.parse(config.database);
        database = new MemoryDatabaseStore();
    }

    let cache;
    if (config.cache.type === 'redis') {
        cache = new RedisStore(RedisCacheSchema.parse(config.cache), logger);
    } else {
        InMemoryCacheSchema.parse(config.cache);
        cache = new MemoryCacheStore();
    }

    return new BackendFiusStores(
        {
            conversation: new DatabaseConversationStore(database, logger),
            sessions: new DatabaseBackedSessionStore(database, cache),
            memories: new DatabaseBackedMemoryStore(database),
            workspaces: new DatabaseBackedWorkspaceStore(database),
            approvals: new DatabaseBackedApprovalStore(database, cache, logger),
            toolPreferences: new DatabaseBackedToolPreferenceStore(database, cache, logger),
            toolState: new DatabaseBackedToolStateStore(database),
            steerQueue: new DatabaseBackedSessionMessageQueueStore(
                database,
                logger,
                SESSION_STEER_QUEUE_KEY_PREFIX
            ),
            followUpQueue: new DatabaseBackedSessionMessageQueueStore(
                database,
                logger,
                SESSION_FOLLOW_UP_QUEUE_KEY_PREFIX
            ),
            customPrompts: new DatabaseBackedCustomPromptStore(database),
            artifacts: new DatabaseBackedArtifactStore(blobStore),
            runtimeEvents: new DatabaseBackedRuntimeEventStore(database),
            toolExecutions: new DatabaseBackedToolExecutionStore(database),
        },
        {
            async connect(): Promise<void> {
                await cache.connect();
                await database.connect();
                await blobStore.connect();
            },
            async disconnect(): Promise<void> {
                await Promise.all([
                    cache.disconnect(),
                    database.disconnect(),
                    blobStore.disconnect(),
                ]);
            },
            isConnected(): boolean {
                return cache.isConnected() && database.isConnected() && blobStore.isConnected();
            },
        },
        'backend'
    );
}

const imageLocal: FiusImage = {
    metadata: {
        name: imageMetadata.name,
        version: imageMetadata.version,
        description: 'Local development image with filesystem and process tools',
        target: 'local-development',
        constraints: ['filesystem-required', 'offline-capable'],
    },
    defaults: {
        storage: {
            blob: { type: 'local', storePath: './data/blobs' },
            database: { type: 'sqlite', path: './data/agent.db' },
            cache: { type: 'in-memory' },
        },
        tools: [
            { type: 'builtin-tools' },
            { type: 'filesystem-tools' },
            { type: 'process-tools' },
            { type: 'todo-tools' },
            { type: 'plan-tools' },
            { type: 'scheduler-tools' },
            { type: 'lifecycle-tools' },
            { type: 'creator-tools' },
            { type: 'agent-spawner' },
        ],
        prompts: [],
    },
    tools: {
        'builtin-tools': builtinToolsFactory,
        'filesystem-tools': fileSystemToolsFactory,
        'process-tools': processToolsFactory,
        'todo-tools': todoToolsFactory,
        'plan-tools': planToolsFactory,
        'scheduler-tools': schedulerToolsFactory,
        'lifecycle-tools': lifecycleToolsFactory,
        'creator-tools': creatorToolsFactory,
        'agent-spawner': agentSpawnerToolsFactory,
    },
    storage: {
        configSchema: StorageSchema,
        createStores: createLocalStores,
    },
    hooks: {
        'content-policy': contentPolicyFactory,
        'response-sanitizer': responseSanitizerFactory,
    },
    compaction: {
        'reactive-overflow': reactiveOverflowCompactionFactory,
        noop: noopCompactionFactory,
    },
    logger: defaultLoggerFactory,
    workspace: {
        create: () => new LocalWorkspaceHandleProvider(),
    },
    skills: {
        create: (context) =>
            createLocalSkillSources({
                workspaceRoot: context?.hostContext?.workspaceRoot,
            }),
    },
};

export default imageLocal;
export { LocalWorkspaceHandleProvider };
