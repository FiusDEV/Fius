


export function isEditWriteTool(toolName: string | undefined): boolean {
    return toolName === 'edit_file' || toolName === 'write_file';
}


export function isPlanUpdateTool(toolName: string | undefined): boolean {
    return toolName === 'plan_update';
}


export function isAutoApprovableInEditMode(toolName: string | undefined): boolean {
    return isEditWriteTool(toolName) || isPlanUpdateTool(toolName);
}
