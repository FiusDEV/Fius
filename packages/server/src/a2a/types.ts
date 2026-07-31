export type TaskState =
    | 'submitted'
    | 'working'
    | 'input-required'
    | 'completed'
    | 'canceled'
    | 'failed'
    | 'rejected'
    | 'auth-required'
    | 'unknown';

export type MessageRole = 'user' | 'agent';

export interface PartBase {
    metadata?: { [key: string]: any };
}

export interface TextPart extends PartBase {
    readonly kind: 'text';
    text: string;
}

export interface FileBase {
    name?: string;
    mimeType?: string;
}

export interface FileWithBytes extends FileBase {
    bytes: string;
    uri?: never;
}

export interface FileWithUri extends FileBase {
    uri: string;
    bytes?: never;
}

export interface FilePart extends PartBase {
    readonly kind: 'file';
    file: FileWithBytes | FileWithUri;
}

export interface DataPart extends PartBase {
    readonly kind: 'data';
    data: { [key: string]: any };
}

export type Part = TextPart | FilePart | DataPart;

export interface Message {
    readonly role: MessageRole;
    parts: Part[];
    metadata?: { [key: string]: any };
    extensions?: string[];
    referenceTaskIds?: string[];
    messageId: string;
    taskId?: string;
    contextId?: string;
    readonly kind: 'message';
}

export interface TaskStatus {
    state: TaskState;
    message?: Message;
    timestamp?: string;
}

export interface Artifact {
    artifactId: string;
    name?: string;
    description?: string;
    parts: Part[];
    metadata?: { [key: string]: any };
    extensions?: string[];
}

export interface Task {
    id: string;
    contextId: string;
    status: TaskStatus;
    history?: Message[];
    artifacts?: Artifact[];
    metadata?: { [key: string]: any };
    readonly kind: 'task';
}

export interface TaskStatusUpdateEvent {
    taskId: string;
    contextId: string;
    readonly kind: 'status-update';
    status: TaskStatus;
    final: boolean;
    metadata?: { [key: string]: any };
}

export interface TaskArtifactUpdateEvent {
    taskId: string;
    contextId: string;
    readonly kind: 'artifact-update';
    artifact: Artifact;
    append?: boolean;
    lastChunk?: boolean;
    metadata?: { [key: string]: any };
}

export interface PushNotificationConfig {
    url: string;
    headers?: { [key: string]: string };
}

export interface MessageSendConfiguration {
    acceptedOutputModes?: string[];
    historyLength?: number;
    pushNotificationConfig?: PushNotificationConfig;
    blocking?: boolean;
}

export interface MessageSendParams {
    message: Message;
    configuration?: MessageSendConfiguration;
    metadata?: { [key: string]: any };
}

export interface TaskQueryParams {
    id: string;
    historyLength?: number;
    metadata?: { [key: string]: any };
}

export interface ListTasksParams {
    contextId?: string;
    status?: TaskState;
    pageSize?: number;
    pageToken?: string;
    historyLength?: number;
    lastUpdatedAfter?: number;
    includeArtifacts?: boolean;
    metadata?: { [key: string]: any };
}

export interface ListTasksResult {
    tasks: Task[];
    totalSize: number;
    pageSize: number;
    nextPageToken: string;
}

export interface TaskIdParams {
    id: string;
    metadata?: { [key: string]: any };
}

export interface ConvertedMessage {
    text: string;
    image:
        | {
              image: string;
              mimeType: string;
          }
        | undefined;
    file:
        | {
              data: string;
              mimeType: string;
              filename?: string;
          }
        | undefined;
}
