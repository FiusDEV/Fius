import chalk from 'chalk';
import { loadAuth, getFiusApiClient, openFiusBillingPage } from '../../auth/index.js';
import { FIUS_CREDITS_URL } from '../../auth/constants.js';

export async function handleBillingStatusCommand(options: { buy?: boolean } = {}): Promise<void> {
    const auth = await loadAuth();

    if (!auth) {
        console.log(chalk.yellow('вќЊ Not logged in to Fius'));
        console.log(chalk.dim('Run `fius login` to authenticate'));
        if (options.buy) {
            await openCreditsPage();
        }
        return;
    }

    if (!auth.fiusApiKey) {
        console.log(chalk.yellow('вќЊ No Fius API key found'));
        console.log(chalk.dim('Run `fius login` to provision an API key'));
        if (options.buy) {
            await openCreditsPage();
        }
        return;
    }

    console.log(chalk.green('вњ… Logged in to Fius'));

    if (auth.email) {
        console.log(chalk.dim(`Account: ${auth.email}`));
    }

    console.log();

    try {
        const apiClient = getFiusApiClient();
        const usage = await apiClient.getUsageSummary(auth.fiusApiKey);

        console.log(chalk.cyan('рџ’° Balance'));
        console.log(`   ${chalk.bold('$' + usage.credits_usd.toFixed(2))} remaining`);
        console.log(chalk.dim(`   Buy more credits: run ${chalk.cyan('fius billing --buy')}`));
        console.log();

        console.log(chalk.cyan('рџ“Љ This Month'));
        console.log(`   Spent: ${chalk.yellow('$' + usage.mtd_usage.total_cost_usd.toFixed(4))}`);
        console.log(`   Requests: ${chalk.yellow(usage.mtd_usage.total_requests.toString())}`);

        const modelEntries = Object.entries(usage.mtd_usage.by_model);
        if (modelEntries.length > 0) {
            console.log();
            console.log(chalk.cyan('рџ“€ Usage by Model'));
            for (const [model, stats] of modelEntries) {
                console.log(
                    `   ${chalk.dim(model)}: $${stats.cost_usd.toFixed(4)} (${stats.requests} requests)`
                );
            }
        }

        if (usage.recent.length > 0) {
            console.log();
            console.log(chalk.cyan('рџ•ђ Recent Activity'));
            for (const entry of usage.recent.slice(0, 5)) {
                const date = new Date(entry.timestamp).toLocaleString();
                console.log(
                    `   ${chalk.dim(date)} - ${entry.model}: $${entry.cost_usd.toFixed(4)}`
                );
            }
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(`вќЊ Failed to fetch billing info: ${errorMessage}`));
        console.log(chalk.dim('Your API key may be invalid. Try `fius login` to refresh.'));
    }

    if (options.buy) {
        await openCreditsPage();
    }
}

async function openCreditsPage(): Promise<void> {
    try {
        await openFiusBillingPage({});
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(chalk.yellow(`вљ пёЏ  Unable to open browser: ${errorMessage}`));
        console.log(chalk.dim(`Open this link to buy credits: ${FIUS_CREDITS_URL}`));
    }
}