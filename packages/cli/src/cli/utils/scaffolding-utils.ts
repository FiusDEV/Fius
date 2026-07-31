import fs from 'fs-extra';
import path from 'path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import * as p from '@clack/prompts';
import { getFiusPackageRoot } from '@fius/agent-management';
import { executeWithTimeout } from './execute.js';
import { textOrExit } from './prompt-helpers.js';
import { getPackageManager, getPackageManagerInstallCommand } from './package-mgmt.js';

function readVersionFromPackageJson(packageJsonPath: string): string | undefined {
    if (!existsSync(packageJsonPath)) {
        return undefined;
    }

    try {
        const content = readFileSync(packageJsonPath, 'utf-8');
        const pkg = JSON.parse(content) as { version?: unknown };
        if (typeof pkg.version === 'string' && pkg.version.length > 0) {
            return pkg.version;
        }
    } catch {

    }

    return undefined;
}

function resolveCliPackageVersion(): string | undefined {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const localPackageJsonPath = path.resolve(scriptDir, '../../../package.json');
    const localVersion = readVersionFromPackageJson(localPackageJsonPath);
    if (localVersion) {
        return localVersion;
    }

    const packageRoot = getFiusPackageRoot();
    if (packageRoot) {
        const packageJsonPath = path.join(packageRoot, 'package.json');
        const packageVersion = readVersionFromPackageJson(packageJsonPath);
        if (packageVersion) {
            return packageVersion;
        }
    }

    return process.env.FIUS_CLI_VERSION;
}

const cliPackageVersion = resolveCliPackageVersion();

export function getFiusCliVersion(): string {
    const version = process.env.FIUS_CLI_VERSION ?? cliPackageVersion;
    if (!version) {
        throw new Error('Could not determine fius CLI version');
    }
    return version;
}

export function getFiusVersionRange(): string {
    return `^${getFiusCliVersion()}`;
}

export function isLocalDependencySpecifier(specifier: string): boolean {
    return (
        specifier.startsWith('.') ||
        specifier.startsWith('/') ||
        specifier.startsWith('file:') ||
        /^[A-Za-z]:[\\/]/.test(specifier)
    );
}

export function hasVersionInPackageSpecifier(specifier: string): boolean {
    if (isLocalDependencySpecifier(specifier)) return true;

    const atIndex = specifier.lastIndexOf('@');
    if (atIndex <= 0) return false;

    if (specifier.startsWith('@')) {
        const slashIndex = specifier.indexOf('/');
        return slashIndex !== -1 && atIndex > slashIndex;
    }

    return true;
}

export function pinFiusPackageIfUnversioned(specifier: string, versionRange: string): string {
    if (isLocalDependencySpecifier(specifier)) return specifier;
    if (!specifier.startsWith('@fius/')) return specifier;
    if (hasVersionInPackageSpecifier(specifier)) return specifier;
    return `${specifier}@${versionRange}`;
}

export function validateProjectName(name: string): string | undefined {
    const nameRegex = /^[a-zA-Z][a-zA-Z0-9-_]*$/;
    if (!nameRegex.test(name)) {
        return 'Must start with a letter and contain only letters, numbers, hyphens, or underscores';
    }
    return undefined;
}

export async function promptForProjectName(
    defaultName: string = 'my-fius-project',
    promptMessage: string = 'What do you want to name your project?'
): Promise<string> {
    let input;
    do {
        input = await textOrExit(
            {
                message: promptMessage,
                placeholder: defaultName,
                defaultValue: defaultName,
            },
            'Project creation cancelled'
        );

        const error = validateProjectName(input);
        if (error) {
            console.log(chalk.red(`Invalid project name: ${error}`));
        }
    } while (validateProjectName(input));

    return input;
}

export async function createProjectDirectory(
    projectName: string,
    spinner: ReturnType<typeof p.spinner>
): Promise<string> {
    const projectPath = path.resolve(process.cwd(), projectName);

    try {
        await fs.mkdir(projectPath);
        return projectPath;
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
            spinner.stop(
                `Directory "${projectName}" already exists. Please choose a different name or delete the existing directory.`
            );
            process.exit(1);
        } else {
            spinner.stop(`Failed to create project: ${error}`);
            throw error;
        }
    }
}

export async function setupGitRepo(projectPath: string): Promise<void> {
    await executeWithTimeout('git', ['init'], { cwd: projectPath });
}

export async function createGitignore(
    projectPath: string,
    additionalEntries: string[] = []
): Promise<void> {
    const baseEntries = ['node_modules', '.env', 'dist', '.fius', '*.log'];
    const allEntries = [...baseEntries, ...additionalEntries];
    await fs.writeFile(path.join(projectPath, '.gitignore'), allEntries.join('\n'));
}

export async function initPackageJson(
    projectPath: string,
    projectName: string,
    type: 'app' | 'image' | 'project'
): Promise<void> {

    await executeWithTimeout('npm', ['init', '-y'], { cwd: projectPath });


    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));

    packageJson.name = projectName;
    packageJson.version = '1.0.0';
    packageJson.type = 'module';


    if (type === 'app') {
        packageJson.description = 'Fius application';
    } else if (type === 'image') {
        packageJson.description = `Fius image providing agent harness`;
        packageJson.main = './dist/index.js';
        packageJson.types = './dist/index.d.ts';
        packageJson.exports = {
            '.': {
                types: './dist/index.d.ts',
                import: './dist/index.js',
            },
        };
    } else if (type === 'project') {
        packageJson.description = 'Custom Fius project';
        packageJson.bin = {
            [projectName]: './dist/src/index.js',
        };
    }

    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
}

export async function createTsconfigForApp(projectPath: string, srcDir: string): Promise<void> {
    const tsconfig = {
        compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'node',
            strict: true,
            esModuleInterop: true,
            forceConsistentCasingInFileNames: true,
            skipLibCheck: true,
            outDir: 'dist',
            rootDir: srcDir,
        },
        include: [`${srcDir}/**/*.ts`],
        exclude: ['node_modules', 'dist', '.fius'],
    };

    await fs.writeJSON(path.join(projectPath, 'tsconfig.json'), tsconfig, { spaces: 4 });
}

export async function createTsconfigForImage(projectPath: string): Promise<void> {
    const tsconfig = {
        compilerOptions: {
            target: 'ES2022',
            module: 'ES2022',
            lib: ['ES2022'],
            moduleResolution: 'bundler',
            outDir: './dist',
            declaration: true,
            declarationMap: true,
            sourceMap: true,
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            forceConsistentCasingInFileNames: true,
            resolveJsonModule: true,
            allowSyntheticDefaultImports: true,
            types: ['node'],
        },
        include: ['fius.image.ts', 'tools/**/*', 'compaction/**/*', 'hooks/**/*'],
        exclude: ['node_modules', 'dist'],
    };

    await fs.writeJSON(path.join(projectPath, 'tsconfig.json'), tsconfig, { spaces: 2 });
}

export async function createTsconfigForProject(projectPath: string): Promise<void> {
    const tsconfig = {
        compilerOptions: {
            target: 'ES2022',
            module: 'ES2022',
            lib: ['ES2022'],
            moduleResolution: 'bundler',
            outDir: './dist',
            declaration: true,
            declarationMap: true,
            sourceMap: true,
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            forceConsistentCasingInFileNames: true,
            resolveJsonModule: true,
            allowSyntheticDefaultImports: true,
            types: ['node'],
        },
        include: [
            'src/**/*',
            'storage/**/*',
            'tools/**/*',
            'hooks/**/*',
            'shared/**/*',
            'fius.config.ts',
        ],
        exclude: ['node_modules', 'dist'],
    };

    await fs.writeJSON(path.join(projectPath, 'tsconfig.json'), tsconfig, { spaces: 2 });
}

export async function installDependencies(
    projectPath: string,
    deps: {
        dependencies?: string[];
        devDependencies?: string[];
    },
    packageManager?: string
): Promise<void> {
    const pm = packageManager || getPackageManager();
    const installCommand = getPackageManagerInstallCommand(pm);

    if (deps.dependencies && deps.dependencies.length > 0) {
        await executeWithTimeout(pm, [installCommand, ...deps.dependencies], {
            cwd: projectPath,
        });
    }

    if (deps.devDependencies && deps.devDependencies.length > 0) {
        await executeWithTimeout(pm, [installCommand, ...deps.devDependencies, '--save-dev'], {
            cwd: projectPath,
        });
    }
}

export async function createEnvExample(
    projectPath: string,
    entries: Record<string, string>
): Promise<void> {
    const content = Object.entries(entries)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');

    await fs.writeFile(path.join(projectPath, '.env.example'), content);
}

export async function ensureDirectory(dirPath: string): Promise<void> {
    await fs.ensureDir(dirPath);
}