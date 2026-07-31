import { FiusRuntimeError, ErrorType } from '@fius/core';
import { RegistryErrorCode } from './error-codes.js';

/**
 * Registry runtime error factory methods
 * Creates properly typed errors for registry operations
 */
export class RegistryError {
    static agentNotFound(agentId: string, availableAgents: string[]) {
        return new FiusRuntimeError(
            RegistryErrorCode.AGENT_NOT_FOUND,
            'agent_registry',
            ErrorType.USER,
            `Agent '${agentId}' not found in registry`,
            { agentId, availableAgents },
            `Available agents: ${availableAgents.join(', ')}. Use a file path for custom agents.`
        );
    }

    static agentInvalidEntry(agentId: string, reason: string) {
        return new FiusRuntimeError(
            RegistryErrorCode.AGENT_INVALID_ENTRY,
            'agent_registry',
            ErrorType.SYSTEM,
            `Registry entry for '${agentId}' is invalid: ${reason}`,
            { agentId, reason },
            'This indicates a problem with the agent registry - please report this issue'
        );
    }

    static agentAlreadyExists(agentId: string) {
        return new FiusRuntimeError(
            RegistryErrorCode.AGENT_ALREADY_EXISTS,
            'agent_registry',
            ErrorType.USER,
            `Agent '${agentId}' already exists in user registry`,
            { agentId },
            'Choose a different name or uninstall the existing agent first'
        );
    }

    static customAgentNameConflict(agentId: string) {
        return new FiusRuntimeError(
            RegistryErrorCode.AGENT_ALREADY_EXISTS,
            'agent_registry',
            ErrorType.USER,
            `Cannot create custom agent '${agentId}': name conflicts with builtin agent`,
            { agentId, conflictType: 'builtin' },
            'Choose a different name for your custom agent'
        );
    }

    static installationFailed(agentId: string, cause: string) {
        return new FiusRuntimeError(
            RegistryErrorCode.INSTALLATION_FAILED,
            'agent_registry',
            ErrorType.SYSTEM,
            `Failed to install agent '${agentId}': ${cause}`,
            { agentId, cause },
            'Check network connection and available disk space'
        );
    }

    static installationValidationFailed(agentId: string, missingPath: string) {
        return new FiusRuntimeError(
            RegistryErrorCode.INSTALLATION_VALIDATION_FAILED,
            'agent_registry',
            ErrorType.SYSTEM,
            `Installation validation failed for '${agentId}': missing main config`,
            { agentId, missingPath },
            'This indicates a problem with the agent bundle - please report this issue'
        );
    }

    static configNotFound(configPath: string) {
        return new FiusRuntimeError(
            RegistryErrorCode.CONFIG_NOT_FOUND,
            'agent_registry',
            ErrorType.SYSTEM,
            `Agent config file not found: ${configPath}`,
            { configPath },
            'This indicates a problem with the agent installation'
        );
    }

    static mainConfigMissing(agentId: string, expectedPath: string) {
        return new FiusRuntimeError(
            RegistryErrorCode.MAIN_CONFIG_MISSING,
            'agent_registry',
            ErrorType.SYSTEM,
            `Main config file not found for agent '${agentId}': ${expectedPath}`,
            { agentId, expectedPath },
            'This indicates a problem with the agent bundle structure'
        );
    }

    static agentNotInstalled(agentId: string) {
        return new FiusRuntimeError(
            RegistryErrorCode.AGENT_NOT_INSTALLED,
            'agent_registry',
            ErrorType.USER,
            `Agent '${agentId}' is not installed`,
            { agentId },
            'Use "fius list-agents --installed" to see installed agents'
        );
    }

    static agentProtected(agentId: string) {
        return new FiusRuntimeError(
            RegistryErrorCode.AGENT_PROTECTED,
            'agent_registry',
            ErrorType.USER,
            `Agent '${agentId}' is protected and cannot be uninstalled. Use --force to override (not recommended for critical agents)`,
            { agentId },
            'Use --force to override (not recommended for critical agents)'
        );
    }

    static uninstallationFailed(agentId: string, cause: string) {
        return new FiusRuntimeError(
            RegistryErrorCode.UNINSTALLATION_FAILED,
            'agent_registry',
            ErrorType.SYSTEM,
            `Failed to uninstall agent '${agentId}': ${cause}`,
            { agentId, cause },
            'Check file permissions and ensure no processes are using the agent'
        );
    }

    static registryNotFound(registryPath: string, cause: string) {
        return new FiusRuntimeError(
            RegistryErrorCode.REGISTRY_NOT_FOUND,
            'agent_registry',
            ErrorType.SYSTEM,
            `Agent registry not found: ${registryPath}: ${cause}`,
            { registryPath },
            'This indicates a problem with the Fius installation - please reinstall or report this issue'
        );
    }

    static registryParseError(registryPath: string, cause: string) {
        return new FiusRuntimeError(
            RegistryErrorCode.REGISTRY_PARSE_ERROR,
            'agent_registry',
            ErrorType.SYSTEM,
            `Failed to parse agent registry from ${registryPath}: ${cause}`,
            { registryPath, cause },
            'This indicates a corrupted registry file - please reinstall Fius'
        );
    }

    static registryWriteError(registryPath: string, cause: string) {
        return new FiusRuntimeError(
            RegistryErrorCode.REGISTRY_WRITE_ERROR,
            'agent_registry',
            ErrorType.SYSTEM,
            `Failed to save agent registry to ${registryPath}: ${cause}`,
            { registryPath, cause },
            'Check file permissions and available disk space'
        );
    }

    static agentNotInstalledAutoInstallDisabled(agentId: string, availableAgents: string[]) {
        return new FiusRuntimeError(
            RegistryErrorCode.AGENT_NOT_INSTALLED_AUTO_INSTALL_DISABLED,
            'agent_registry',
            ErrorType.USER,
            `Agent '${agentId}' is not installed locally and auto-install is disabled`,
            { agentId, availableAgents },
            `Use 'fius install ${agentId}' to install it manually, or use a file path for custom agents`
        );
    }
}
