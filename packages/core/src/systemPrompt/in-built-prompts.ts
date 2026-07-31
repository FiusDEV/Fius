import { DynamicContributorContext } from './types.js';




export async function getCurrentDate(_context: DynamicContributorContext): Promise<string> {
    const date = new Date().toISOString().split('T')[0];
    return `<date>Current date: ${date}</date>`;
}


export async function getEnvironmentInfo(context: DynamicContributorContext): Promise<string> {
    if (typeof process === 'undefined' || !process.cwd) {
        return '<environment>Environment info not available in browser context</environment>';
    }

    try {
        const [{ existsSync }, { platform }, { join }] = await Promise.all([
            import('fs'),
            import('os'),
            import('path'),
        ]);

        const cwd = context.environment?.cwd || context.workspace?.path || process.cwd();
        const os = context.environment?.platform || platform();
        const isGitRepo = context.environment?.isGitRepo ?? existsSync(join(cwd, '.git'));
        const shell =
            context.environment?.shell ||
            process.env.SHELL ||
            (os === 'win32' ? 'cmd.exe' : '/bin/sh');

        return `<environment>
  <cwd>${cwd}</cwd>
  <platform>${os}</platform>
  <is_git_repo>${isGitRepo}</is_git_repo>
  <shell>${shell}</shell>
</environment>`;
    } catch {
        return '<environment>Environment info not available</environment>';
    }
}

export async function getResourceData(context: DynamicContributorContext): Promise<string> {
    const resources = await context.mcpManager.listAllResources();
    if (!resources || resources.length === 0) {
        return '<resources></resources>';
    }
    const parts = await Promise.all(
        resources.map(async (resource) => {
            try {
                const response = await context.mcpManager.readResource(resource.key);
                const first = response?.contents?.[0];
                let content: string;
                if (first && 'text' in first && first.text && typeof first.text === 'string') {
                    content = first.text;
                } else if (
                    first &&
                    'blob' in first &&
                    first.blob &&
                    typeof first.blob === 'string'
                ) {
                    content = first.blob;
                } else {
                    content = JSON.stringify(response, null, 2);
                }
                const label = resource.summary.name || resource.summary.uri;
                return `<resource uri="${resource.key}" name="${label}">${content}</resource>`;
            } catch (error: any) {
                return `<resource uri="${resource.key}">Error loading resource: ${
                    error.message || error
                }</resource>`;
            }
        })
    );
    return `<resources>\n${parts.join('\n')}\n</resources>`;
}
