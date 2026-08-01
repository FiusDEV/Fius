import path from 'path';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import { selectOrExit, textOrExit } from '../utils/prompt-helpers.js';
import {
    promptForProjectName,
    createProjectDirectory,
    setupGitRepo,
    createGitignore,
    initPackageJson,
    createTsconfigForImage,
    getFiusVersionRange,
    installDependencies,
    pinFiusPackageIfUnversioned,
    ensureDirectory,
} from '../utils/scaffolding-utils.js';
import {
    generateFiusImageFile,
    generateImageReadme,
    generateExampleTool,
    generateExampleHook,
    generateExampleCompaction,
} from '../utils/template-engine.js';
import fs from 'fs-extra';
import { getExecutionContext } from '@fiusdev/agent-management';

export async function createImage(name?: string): Promise<string> {
    console.log(chalk.blue('рџЋЁ Creating a Fius image - a distributable agent harness package\n'));

    const projectName = name
        ? name
        : await promptForProjectName('my-fius-image', 'What do you want to name your image?');

    const description = await textOrExit(
        {
            message: 'Describe your image:',
            placeholder: 'Custom agent harness for my organization',
            defaultValue: 'Custom agent harness for my organization',
        },
        'Image creation cancelled'
    );

    const startingPoint = await selectOrExit<'base' | 'extend'>(
        {
            message: 'How do you want to start?',
            initialValue: 'extend',
            options: [
                { value: 'extend', label: 'Extend existing image (Recommended)' },
                { value: 'base', label: 'New image (from scratch)' },
            ],
        },
        'Image creation cancelled'
    );

    let baseImage: string | undefined;
    if (startingPoint === 'extend') {
        const baseImageChoice = await selectOrExit<string>(
            {
                message: 'Which image to extend?',
                options: [
                    {
                        value: '@fiusdev/image-local',
                        label: '@fiusdev/image-local (local development)',
                    },
                    { value: 'custom', label: 'Custom npm package...' },
                ],
            },
            'Image creation cancelled'
        );

        if (baseImageChoice === 'custom') {
            const customBase = await textOrExit(
                {
                    message: 'Enter the npm package name:',
                    placeholder: '@myorg/image-base',
                    validate: (value) => {
                        if (!value || value.trim() === '') {
                            return 'Package name is required';
                        }
                        return undefined;
                    },
                },
                'Image creation cancelled'
            );

            baseImage = customBase;
        } else {
            baseImage = baseImageChoice;
        }
    }

    const target = await selectOrExit<string>(
        {
            message: 'Target environment:',
            options: [
                { value: 'local-development', label: 'Local development' },
                { value: 'cloud-production', label: 'Cloud production' },
                { value: 'edge-serverless', label: 'Edge/serverless' },
                { value: 'custom', label: 'Custom' },
            ],
        },
        'Image creation cancelled'
    );

    const spinner = p.spinner();
    let projectPath: string | undefined;

    try {
        projectPath = await createProjectDirectory(projectName, spinner);

        process.chdir(projectPath);

        spinner.start('Setting up project structure...');

        await ensureDirectory('tools/example-tool');
        const exampleToolCode = generateExampleTool('example-tool');
        await fs.writeFile('tools/example-tool/index.ts', exampleToolCode);

        await ensureDirectory('hooks/example-hook');
        const exampleHookCode = generateExampleHook('example-hook');
        await fs.writeFile('hooks/example-hook/index.ts', exampleHookCode);

        await ensureDirectory('compaction/example-compaction');
        const exampleCompactionCode = generateExampleCompaction('example-compaction');
        await fs.writeFile('compaction/example-compaction/index.ts', exampleCompactionCode);

        spinner.message('Generating configuration files...');

        const fiusImageContent = generateFiusImageFile({
            projectName,
            packageName: projectName,
            description,
            imageName: projectName,
            ...(baseImage ? { baseImage } : {}),
            target,
        });
        await fs.writeFile('fius.image.ts', fiusImageContent);

        await initPackageJson(projectPath, projectName, 'image');

        const packageJsonPath = path.join(projectPath, 'package.json');
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
        packageJson.scripts = {
            build: 'fius-bundle build',
            typecheck: 'tsc --noEmit',
            ...packageJson.scripts,
        };
        await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

        await createTsconfigForImage(projectPath);

        const readmeContent = generateImageReadme({
            projectName,
            packageName: projectName,
            description,
            imageName: projectName,
            ...(baseImage ? { baseImage } : {}),
        });
        await fs.writeFile('README.md', readmeContent);


        await createGitignore(projectPath, ['*.tsbuildinfo']);


        spinner.message('Initializing git repository...');
        await setupGitRepo(projectPath);

        spinner.message('Installing dependencies...');

        const executionContext = getExecutionContext();
        const isFiusSource = executionContext === 'fius-source';

        const versionRange = getFiusVersionRange();
        const fiusDependencyVersion = isFiusSource ? 'workspace:*' : versionRange;

        const dependencies: string[] = [
            `@fiusdev/core@${fiusDependencyVersion}`,
            `@fiusdev/agent-config@${fiusDependencyVersion}`,
            `@fiusdev/storage@${fiusDependencyVersion}`,
            'zod@^3.25.0',
        ];
        const devDependencies = [
            'typescript@^5.0.0',
            '@types/node@^20.0.0',
            `@fiusdev/image-bundler@${fiusDependencyVersion}`,
        ];

        if (baseImage) {
            const baseImageDependency = pinFiusPackageIfUnversioned(
                baseImage,
                isFiusSource ? fiusDependencyVersion : versionRange
            );
            dependencies.push(baseImageDependency);
        }

        await installDependencies(
            projectPath,
            {
                dependencies,
                devDependencies,
            },
            isFiusSource ? 'pnpm' : undefined
        );

        spinner.stop(chalk.green(`вњ“ Successfully created image: ${projectName}`));

        console.log(`\n${chalk.cyan('Next steps:')}`);
        console.log(`  ${chalk.gray('$')} cd ${projectName}`);
        console.log(`  ${chalk.gray('$')} pnpm run build`);
        console.log(
            `\n${chalk.gray('Add your custom providers to the convention-based folders:')}`
        );
        console.log(`  ${chalk.gray('tools/')}            - Tool factories`);
        console.log(`  ${chalk.gray('compaction/')}       - Compaction factories`);
        console.log(`  ${chalk.gray('hooks/')}            - Hook factories`);

        console.log(`\n${chalk.gray('Install into the Fius CLI:')}`);
        if (isFiusSource) {
            console.log(`  ${chalk.gray('$')} fius image install .`);
            console.log(
                chalk.dim(
                    `  (linked install from local directory; workspace:* deps can't be installed into the global store)`
                )
            );
        } else {
            console.log(`  ${chalk.gray('$')} npm pack`);
            console.log(`  ${chalk.gray('$')} fius image install ./<generated-file>.tgz`);
        }
        console.log(`\n${chalk.gray('Use it in an agent YAML:')}`);
        console.log(`  ${chalk.gray('image:')} '${projectName}'`);
        console.log(`  ${chalk.gray('# or:')} fius --image ${projectName}\n`);
    } catch (error) {
        if (spinner) {
            spinner.stop(chalk.red('вњ— Failed to create image'));
        }
        throw error;
    }

    if (!projectPath) {
        throw new Error('Failed to create project directory');
    }

    return projectPath;
}