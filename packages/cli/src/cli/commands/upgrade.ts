import { z } from 'zod';
import {
    createLegacyNpmUninstallCommand,
    createNativeInstallCommand,
    detectInstallMethod,
    detectUnsupportedPackageManagerFromPath,
    executeManagedCommand,
    normalizeRequestedVersion,
} from '../utils/self-management.js';

const UpgradeCommandSchema = z
    .object({
        dryRun: z.boolean().default(false),
        force: z.boolean().default(false),
    })
    .strict();

export type UpgradeCommandOptions = z.output<typeof UpgradeCommandSchema>;

function printMultiInstallWarning(warning: string | null): void {
    if (!warning) {
        return;
    }

    console.warn(`вљ пёЏ  ${warning}`);
}

async function runNativeUpgrade(
    version: string | null,
    installDir: string | null,
    options: UpgradeCommandOptions
): Promise<void> {
    const nativeCommand = createNativeInstallCommand({
        version,
        installDir,
        force: options.force,
    });

    console.log('в¬†пёЏ  Upgrading Fius via native installer...');
    await executeManagedCommand(nativeCommand, { dryRun: options.dryRun });
}

async function runHardMigrationToNative(
    version: string | null,
    options: UpgradeCommandOptions
): Promise<void> {
    console.log('рџ”Ѓ Detected npm global install. Migrating to native installer...');

    await runNativeUpgrade(version, null, options);

    const uninstallCommand = createLegacyNpmUninstallCommand();

    console.log('рџ§№ Removing legacy npm global install...');

    try {
        await executeManagedCommand(uninstallCommand, { dryRun: options.dryRun });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`вљ пёЏ  Automatic npm uninstall failed: ${message}`);
        console.warn(`Run this command manually: ${uninstallCommand.displayCommand}`);
    }
}

function getUnsupportedCleanupHint(manager: 'pnpm' | 'bun'): string {
    if (manager === 'pnpm') {
        return 'pnpm unlink --global fius (linked/source) or pnpm remove -g fius (global package)';
    }

    return 'bun remove -g fius';
}

function buildProjectLocalInstallMessage(binaryPath: string | null): string {
    const resolvedPath = binaryPath ?? 'node_modules/.bin/fius';
    return [
        `Project-local install detected at ${resolvedPath}.`,
        'Self-upgrade is only available for native installs and legacy global npm installs.',
        'Use the owning project package manager instead.',
    ].join(' ');
}

export async function handleUpgradeCommand(
    versionArg: string | undefined,
    options: Partial<UpgradeCommandOptions>
): Promise<void> {
    const validated = UpgradeCommandSchema.parse(options);
    const version = normalizeRequestedVersion(versionArg);

    const detection = await detectInstallMethod();
    printMultiInstallWarning(detection.multipleInstallWarning);

    if (version) {
        console.log(`рџЋЇ Target version: ${version}`);
    } else {
        console.log('рџЋЇ Target version: latest');
    }

    switch (detection.method) {
        case 'native':
            await runNativeUpgrade(version, detection.installDir, validated);
            break;
        case 'npm':
            await runHardMigrationToNative(version, validated);
            break;
        case 'project-local':
            throw new Error(buildProjectLocalInstallMessage(detection.installedPath));
        case 'unknown':
        default:
            if (detection.installedPath) {
                const unsupportedManager = detectUnsupportedPackageManagerFromPath(
                    detection.installedPath
                );
                if (unsupportedManager) {
                    console.warn(
                        `вљ пёЏ  Active binary appears to come from ${unsupportedManager}. ` +
                            'Fius only auto-migrates npm installs.'
                    );
                }
            }
            console.warn(
                'вљ пёЏ  Could not determine install method. Falling back to native installer upgrade.'
            );
            await runNativeUpgrade(version, null, validated);
            break;
    }

    const postDetection = await detectInstallMethod();
    printMultiInstallWarning(postDetection.multipleInstallWarning);

    if (postDetection.method !== 'native' && postDetection.installedPath) {
        const unsupportedManager = detectUnsupportedPackageManagerFromPath(
            postDetection.installedPath
        );
        const followUp = unsupportedManager
            ? `Run ${getUnsupportedCleanupHint(unsupportedManager)}, then run fius upgrade again.`
            : 'Remove the stale binary from PATH, then run fius upgrade again.';
        const message =
            `Upgrade completed, but active binary is still non-native: ${postDetection.installedPath}. ` +
            followUp;

        if (validated.dryRun) {
            console.warn(`вљ пёЏ  ${message}`);
        } else {
            throw new Error(message);
        }
    }

    if (validated.dryRun) {
        console.log('вњ… Dry run completed. No changes were made.');
        return;
    }

    console.log('вњ… Fius upgrade completed.');
}