export interface ListViewportSizingOptions {
    
    rows: number;
    
    hardCap: number;
    
    reservedRows?: number;
    
    minVisibleItems?: number;
}


export function getMaxVisibleItemsForTerminalRows({
    rows,
    hardCap,
    reservedRows = 6,
    minVisibleItems = 1,
}: ListViewportSizingOptions): number {
    const available = Math.max(0, rows - reservedRows);
    if (available <= 0) {
        return 1;
    }

    return Math.max(minVisibleItems, Math.min(hardCap, available));
}
