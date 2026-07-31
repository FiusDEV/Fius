import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface GitCommandResult {
    success: boolean;
    stdout: string;
    stderr: string;
}

export async function runGit(
    args: string[],
    cwd?: string
): Promise<GitCommandResult> {
    try {
        const { stdout, stderr } = await execAsync(`git ${args.join(' ')}`, {
            cwd,
            maxBuffer: 1024 * 1024 * 10,
            timeout: 30000,
        });
        return { success: true, stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (error: any) {
        return {
            success: false,
            stdout: error.stdout?.trim() ?? '',
            stderr: error.stderr?.trim() ?? error.message,
        };
    }
}

export async function isGitRepo(cwd?: string): Promise<boolean> {
    const result = await runGit(['rev-parse', '--is-inside-work-tree'], cwd);
    return result.success && result.stdout === 'true';
}

export async function getGitRoot(cwd?: string): Promise<string | null> {
    const result = await runGit(['rev-parse', '--show-toplevel'], cwd);
    return result.success ? result.stdout : null;
}
