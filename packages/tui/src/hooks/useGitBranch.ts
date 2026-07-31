

import { useState, useEffect } from 'react';
import { execSync } from 'child_process';


export function useGitBranch(cwd?: string): string | undefined {
    const [branchName, setBranchName] = useState<string | undefined>(undefined);

    useEffect(() => {
        const workingDir = cwd || process.cwd();

        try {
            // Get current branch name using git rev-parse --abbrev-ref HEAD
            // This is faster and more reliable than parsing git branch output
            const result = execSync('git rev-parse --abbrev-ref HEAD', {
                cwd: workingDir,
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            const branch = result.trim();
            setBranchName(branch || undefined);
        } catch {
            // Not in a git repo, git not installed, or command failed
            setBranchName(undefined);
        }
    }, [cwd]);

    return branchName;
}
