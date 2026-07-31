import * as p from '@clack/prompts';

type SelectOptions = Parameters<typeof p.select>[0];
type TextOptions = Parameters<typeof p.text>[0];
type ConfirmOptions = Parameters<typeof p.confirm>[0];
type MultiselectOptions = Parameters<typeof p.multiselect>[0];





export async function selectOrExit<T extends string>(
    options: SelectOptions,
    cancelMessage = 'Cancelled'
): Promise<T> {
    const result = await p.select(options);
    if (p.isCancel(result)) {
        p.cancel(cancelMessage);
        process.exit(0);
    }
    return result as T;
}

export async function textOrExit(
    options: TextOptions,
    cancelMessage = 'Cancelled'
): Promise<string> {
    const result = await p.text(options);
    if (p.isCancel(result)) {
        p.cancel(cancelMessage);
        process.exit(0);
    }
    return result;
}

export async function confirmOrExit(
    options: ConfirmOptions,
    cancelMessage = 'Cancelled'
): Promise<boolean> {
    const result = await p.confirm(options);
    if (p.isCancel(result)) {
        p.cancel(cancelMessage);
        process.exit(0);
    }
    return result;
}

export async function multiselectOrExit<T extends string>(
    options: MultiselectOptions,
    cancelMessage = 'Cancelled'
): Promise<T[]> {
    const result = await p.multiselect(options);
    if (p.isCancel(result)) {
        p.cancel(cancelMessage);
        process.exit(0);
    }
    return result as T[];
}