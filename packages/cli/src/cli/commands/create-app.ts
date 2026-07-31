import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import * as p from '@clack/prompts';
import { selectOrExit } from '../utils/prompt-helpers.js';
import {
    promptForProjectName,
    createProjectDirectory,
    setupGitRepo,
    createGitignore,
    initPackageJson,
    createTsconfigForApp,
    installDependencies,
    createEnvExample,
    ensureDirectory,
    getFiusVersionRange,
} from '../utils/scaffolding-utils.js';
import {
    generateIndexForCodeFirstDI,
    generateWebServerIndexForCodeFirstDI,
    generateWebAppHTML,
    generateWebAppJS,
    generateWebAppCSS,
    generateAppReadme,
} from '../utils/template-engine.js';
import { getExecutionContext } from '@fius/agent-management';

type AppType = 'script' | 'webapp';

export interface CreateAppOptions {
    type?: AppType;
}

export async function createFiusProject(
    name?: string,
    options?: CreateAppOptions
): Promise<string> {
    console.log(chalk.blue('рџљЂ Creating a Fius application\n'));

    const projectName = name
        ? name
        : await promptForProjectName('my-fius-app', 'What do you want to name your app?');

    let appType: AppType = options?.type ?? 'script';

    if (!options?.type) {
        appType = await selectOrExit<AppType>(
            {
                message: 'What type of app?',
                options: [
                    { value: 'script', label: 'Script', hint: 'Simple script (default)' },
                    {
                        value: 'webapp',
                        label: 'Web App',
                        hint: 'REST API server with web frontend',
                    },
                ],
            },
            'App creation cancelled'
        );
    }

    const spinner = p.spinner();
    const originalCwd = process.cwd();
    let projectPath: string | undefined;

    try {
        projectPath = await createProjectDirectory(projectName, spinner);
        process.chdir(projectPath);

        await scaffoldCodeFirstDI(projectPath, projectName, appType, spinner);

        spinner.stop(chalk.green(`вњ“ Successfully created app: ${projectName}`));

        console.log(`\n${chalk.cyan('Next steps:')}`);
        console.log(`  ${chalk.gray('$')} cd ${projectName}`);
        console.log(`  ${chalk.gray('$')} pnpm start`);
        console.log(`\n${chalk.gray('Learn more:')} https://docs.fius.ai\n`);

        return projectPath;
    } catch (error) {
        if (originalCwd) {
            try {
                process.chdir(originalCwd);
            } catch {
            }
        }

        if (spinner) {
            spinner.stop(chalk.red('вњ— Failed to create app'));
        }
        throw error;
    }
}

async function scaffoldCodeFirstDI(
    projectPath: string,
    projectName: string,
    appType: AppType,
    spinner: ReturnType<typeof p.spinner>
): Promise<void> {
    spinner.start('Setting up app structure...');

    await ensureDirectory('src');

    let indexContent: string;
    if (appType === 'webapp') {
        indexContent = generateWebServerIndexForCodeFirstDI({
            projectName,
            packageName: projectName,
            description: 'Fius web server application',
        });

        await ensureDirectory('app');
        await ensureDirectory('app/assets');
        await fs.writeFile('app/index.html', generateWebAppHTML(projectName));
        await fs.writeFile('app/assets/main.js', generateWebAppJS());
        await fs.writeFile('app/assets/style.css', generateWebAppCSS());
    } else {
        indexContent = generateIndexForCodeFirstDI({
            projectName,
            packageName: projectName,
            description: 'Fius application',
        });
    }

    await fs.writeFile('src/index.ts', indexContent);

    spinner.message('Creating configuration files...');

    await initPackageJson(projectPath, projectName, 'app');

    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));

    packageJson.scripts = {
        start: 'tsx src/index.ts',
        build: 'tsc',
        ...packageJson.scripts,
    };
    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

    await createTsconfigForApp(projectPath, 'src');

    const readmeContent = generateAppReadme({
        projectName,
        packageName: projectName,
        description: 'Fius application',
    });
    await fs.writeFile('README.md', readmeContent);

    await createEnvExample(projectPath, {
        OPENAI_API_KEY: 'sk-...',
        ANTHROPIC_API_KEY: 'sk-ant-...',
    });

    await createGitignore(projectPath);

    spinner.message('Initializing git repository...');
    await setupGitRepo(projectPath);

    spinner.message('Installing dependencies...');

    const executionContext = getExecutionContext();
    const isFiusSource = executionContext === 'fius-source';

    const versionRange = getFiusVersionRange();
    const fiusDependencyVersion = isFiusSource ? 'workspace:*' : versionRange;

    const dependencies = [
        `@fius/core@${fiusDependencyVersion}`,
        `@fius/storage@${fiusDependencyVersion}`,
        'dotenv',
        'tsx',
    ];

    if (appType === 'webapp') {
        dependencies.push(`@fius/server@${fiusDependencyVersion}`);
    }

    await installDependencies(
        projectPath,
        {
            dependencies,
            devDependencies: ['typescript@^5.0.0', '@types/node@^20.0.0'],
        },
        isFiusSource ? 'pnpm' : undefined
    );
}