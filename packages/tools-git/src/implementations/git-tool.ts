import { z } from 'zod';
import { createLocalToolCallHeader, defineTool } from '@fiusdev/core/tools';
import type { Tool, ToolExecutionContext } from '@fiusdev/core/tools';
import { runGit, isGitRepo } from '../git-runner.js';

const GitInputSchema = z
    .object({
        action: z
            .enum(['status', 'diff', 'log', 'add', 'commit', 'push', 'pull', 'branch', 'stash', 'pr'])
            .describe('Git operation to perform'),
        message: z.string().optional().describe('Commit message (for commit), stash message (for stash save)'),
        files: z.array(z.string()).optional().describe('Files to stage (for add)'),
        remote: z.string().optional().describe('Remote name (for push/pull, default: origin)'),
        branch: z.string().optional().describe('Branch name (for branch create/checkout, or push/pull target)'),
        count: z.number().optional().describe('Number of commits to show (for log, default: 10)'),
        staged: z.boolean().optional().describe('Show staged changes (for diff)'),
        force: z.boolean().optional().describe('Force push or force delete branch'),
        title: z.string().optional().describe('PR title (for pr)'),
    })
    .strict();

export function createGitTool(): Tool<typeof GitInputSchema> {
    return defineTool({
        id: 'git',
        description:
            'Perform Git operations. Actions: status (working tree), diff (changes), log (history), ' +
            'add (stage files, use ["."]), commit (create commit), push (to remote), pull (from remote), ' +
            'branch (list/create/switch), stash (save/pop/list), pr (create pull request via gh CLI).',
        inputSchema: GitInputSchema,
        presentation: {
            describeHeader: (input) => {
                const desc = [
                    input.action,
                    input.message?.slice(0, 30),
                    input.files?.join(','),
                    input.branch,
                ]
                    .filter(Boolean)
                    .join(' ');
                return createLocalToolCallHeader({ title: 'Git', argsText: desc });
            },
        },
        async execute(input, context: ToolExecutionContext) {
            const cwd = context.workspace?.path;

            if (!(await isGitRepo(cwd))) {
                return { success: false, error: 'Not a git repository' };
            }

            const { action } = input;

            switch (action) {
                case 'status': {
                    const result = await runGit(['status', '--short'], cwd);
                    return result.success
                        ? { success: true, status: result.stdout || 'Working tree clean' }
                        : { success: false, error: result.stderr };
                }

                case 'diff': {
                    const args = ['diff'];
                    if (input.staged) args.push('--staged');
                    if (input.branch) args.push(input.branch);
                    const result = await runGit(args, cwd);
                    return result.success
                        ? { success: true, diff: result.stdout || 'No changes' }
                        : { success: false, error: result.stderr };
                }

                case 'log': {
                    const count = input.count ?? 10;
                    const result = await runGit(['log', `-n`, String(count), '--oneline'], cwd);
                    return result.success
                        ? { success: true, log: result.stdout || 'No commits found' }
                        : { success: false, error: result.stderr };
                }

                case 'add': {
                    const files = input.files?.length ? input.files : ['.'];
                    const result = await runGit(['add', '--', ...files], cwd);
                    return result.success
                        ? { success: true, message: `Staged: ${files.join(', ')}` }
                        : { success: false, error: result.stderr };
                }

                case 'commit': {
                    if (!input.message) return { success: false, error: 'message is required for commit' };
                    const result = await runGit(['commit', '-m', input.message], cwd);
                    return result.success
                        ? { success: true, message: result.stdout }
                        : { success: false, error: result.stderr };
                }

                case 'push': {
                    const remote = input.remote ?? 'origin';
                    const args = ['push', remote];
                    if (input.branch) args.push(input.branch);
                    if (input.force) args.push('--force');
                    const result = await runGit(args, cwd);
                    return result.success
                        ? { success: true, message: result.stdout || 'Pushed' }
                        : { success: false, error: result.stderr };
                }

                case 'pull': {
                    const remote = input.remote ?? 'origin';
                    const args = ['pull', '--rebase', remote];
                    if (input.branch) args.push(input.branch);
                    const result = await runGit(args, cwd);
                    return result.success
                        ? { success: true, message: result.stdout || 'Pulled' }
                        : { success: false, error: result.stderr };
                }

                case 'branch': {
                    if (input.branch && input.force) {
                        const result = await runGit(['branch', '-D', input.branch], cwd);
                        return result.success
                            ? { success: true, message: `Deleted branch ${input.branch}` }
                            : { success: false, error: result.stderr };
                    }
                    if (input.branch) {
                        const result = await runGit(['checkout', input.branch], cwd);
                        return result.success
                            ? { success: true, message: `Switched to ${input.branch}` }
                            : { success: false, error: result.stderr };
                    }
                    const result = await runGit(['branch', '-a'], cwd);
                    return result.success
                        ? { success: true, branches: result.stdout }
                        : { success: false, error: result.stderr };
                }

                case 'stash': {
                    const result = await runGit(['stash'], cwd);
                    return result.success
                        ? { success: true, message: result.stdout || 'Stashed' }
                        : { success: false, error: result.stderr };
                }

                case 'pr': {
                    const title = input.title || 'Pull Request';
                    const ghCheck = await runGit(['--version'], cwd);
                    if (ghCheck.success) {
                        const result = await runGit(
                            ['pr', 'create', '--title', title, '--base', 'main'],
                            cwd
                        );
                        if (result.success) return { success: true, prUrl: result.stdout };
                    }
                    const pushResult = await runGit(['push', '-u', 'origin'], cwd);
                    return pushResult.success
                        ? { success: true, message: `Pushed. Create PR on GitHub.` }
                        : { success: false, error: pushResult.stderr };
                }

                default:
                    return { success: false, error: `Unknown action: ${action}` };
            }
        },
    });
}
