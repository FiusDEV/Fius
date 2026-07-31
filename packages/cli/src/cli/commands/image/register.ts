import type { Command } from 'commander';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import { withAnalytics, safeExit, ExitSignal } from '../../../analytics/wrapper.js';
import type { ImageInstallCommandOptionsInput } from '../image.js';

export interface ImageCommandRegisterContext {
    program: Command;
}

export function registerImageCommand({ program }: ImageCommandRegisterContext): void {

    program
        .command('create-image [name]', { hidden: true })
        .description('Alias for `fius image create`')
        .action(
            withAnalytics('create-image', async (name?: string) => {
                try {
                    p.intro(chalk.inverse('Create Fius Image'));


                    const { createImage } = await import('../create-image.js');
                    const projectPath = await createImage(name);

                    p.outro(
                        chalk.greenBright(`Fius image created successfully at ${projectPath}!`)
                    );
                    safeExit('create-image', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`вќЊ fius create-image command failed: ${err}`);
                    safeExit('create-image', 1, 'error');
                }
            })
        );


    const imageCommand = program.command('image').description('Manage images');

    imageCommand.addHelpText(
        'after',
        `
Examples:
  $ fius image create my-image
  $ fius image install @fius/image-local
  $ fius image install @myorg/my-image@1.2.3
  $ fius image list
  $ fius image use @myorg/my-image@1.2.3
  $ fius image remove @myorg/my-image@1.2.3
  $ fius image doctor
`
    );

    imageCommand
        .command('create [name]')
        .description('Create a Fius image project (scaffold)')
        .action(
            withAnalytics('image create', async (name?: string) => {
                try {
                    p.intro(chalk.inverse('Create Fius Image'));


                    const { createImage } = await import('../create-image.js');
                    const projectPath = await createImage(name);

                    p.outro(
                        chalk.greenBright(`Fius image created successfully at ${projectPath}!`)
                    );
                    safeExit('image create', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`вќЊ fius image create command failed: ${err}`);
                    safeExit('image create', 1, 'error');
                }
            })
        );

    imageCommand
        .command('install <image>')
        .description('Install an image into the local Fius image store')
        .option('--force', 'Force reinstall if already installed')
        .option('--no-activate', 'Do not set as the active version')
        .addHelpText(
            'after',
            `
Examples:
  $ fius image install @fius/image-local
  $ fius image install @myorg/my-image@1.2.3
  $ fius image install ./my-image-1.0.0.tgz
`
        )
        .action(
            withAnalytics(
                'image install',
                async (image: string, options: Omit<ImageInstallCommandOptionsInput, 'image'>) => {
                    try {
                        const { handleImageInstallCommand } = await import('../image.js');
                        await handleImageInstallCommand({ ...options, image });
                        safeExit('image install', 0);
                    } catch (err) {
                        if (err instanceof ExitSignal) throw err;
                        console.error(`вќЊ fius image install command failed: ${err}`);
                        safeExit('image install', 1, 'error');
                    }
                }
            )
        );

    imageCommand
        .command('list')
        .description('List installed images')
        .action(
            withAnalytics('image list', async () => {
                try {
                    const { handleImageListCommand } = await import('../image.js');
                    await handleImageListCommand();
                    safeExit('image list', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`вќЊ fius image list command failed: ${err}`);
                    safeExit('image list', 1, 'error');
                }
            })
        );

    imageCommand
        .command('use <image>')
        .description('Set the active version for an installed image (image@version)')
        .action(
            withAnalytics('image use', async (image: string) => {
                try {
                    const { handleImageUseCommand } = await import('../image.js');
                    await handleImageUseCommand({ image });
                    safeExit('image use', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`вќЊ fius image use command failed: ${err}`);
                    safeExit('image use', 1, 'error');
                }
            })
        );

    imageCommand
        .command('remove <image>')
        .description('Remove an image from the store (image or image@version)')
        .action(
            withAnalytics('image remove', async (image: string) => {
                try {
                    const { handleImageRemoveCommand } = await import('../image.js');
                    await handleImageRemoveCommand({ image });
                    safeExit('image remove', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`вќЊ fius image remove command failed: ${err}`);
                    safeExit('image remove', 1, 'error');
                }
            })
        );

    imageCommand
        .command('doctor')
        .description('Print image store diagnostics')
        .action(
            withAnalytics('image doctor', async () => {
                try {
                    const { handleImageDoctorCommand } = await import('../image.js');
                    await handleImageDoctorCommand();
                    safeExit('image doctor', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`вќЊ fius image doctor command failed: ${err}`);
                    safeExit('image doctor', 1, 'error');
                }
            })
        );
}