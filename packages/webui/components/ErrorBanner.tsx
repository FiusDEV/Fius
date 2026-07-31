import { useState } from 'react';
import { AlertTriangle, CreditCard, ChevronDown, ChevronUp, X } from 'lucide-react';
import { type ErrorMessage } from '@/lib/stores/chatStore';
import type { Issue } from '@fius/core';
import { CopyButton } from './ui/copy-button';
import { SpeakButton } from './ui/speak-button';

const BILLING_URL = 'https://fius.dev/workspace';

function isInsufficientCreditsError(message: string): boolean {
    const lower = message.toLowerCase();
    return (
        lower.includes('insufficient') &&
        lower.includes('credit')
    ) || (
        lower.includes('out of') &&
        lower.includes('credit')
    ) || (
        lower.includes('payment_required') ||
        lower.includes('payment required')
    );
}

interface ErrorBannerProps {
    error: ErrorMessage;
    onDismiss: () => void;
}

export default function ErrorBanner({ error, onDismiss }: ErrorBannerProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const insufficientCredits = isInsufficientCreditsError(error.message);

    const firstIssue = error.detailedIssues?.[0];
    const detailedIssues =
        firstIssue?.context &&
        typeof firstIssue.context === 'object' &&
        'detailedIssues' in firstIssue.context
            ? (firstIssue.context as { detailedIssues: Issue[] }).detailedIssues
            : [];

    const fullErrorText =
        detailedIssues.length > 0
            ? `${error.message}\n\nDetails:\n${detailedIssues
                  .map((issue: Issue) => {
                      let text = issue.message;
                      if (issue.context) {
                          const contextStr =
                              typeof issue.context === 'string'
                                  ? issue.context
                                  : JSON.stringify(issue.context, null, 2);
                          text += `\nContext: ${contextStr}`;
                      }
                      return text;
                  })
                  .join('\n\n')}`
            : error.message;

    if (insufficientCredits) {
        return (
            <div className="w-full rounded-lg p-4 mb-4 border shadow-sm bg-amber-500/10 border-amber-500/40">
                <div className="flex items-start gap-3">
                    <CreditCard className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-medium text-amber-600 dark:text-amber-400">
                            Out of Fius credits
                        </h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                            This request stopped because your Fius balance ran out.
                        </p>
                        <div className="mt-3">
                            <a
                                href={BILLING_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-amber-500 text-white hover:bg-amber-600 transition-colors"
                            >
                                <CreditCard className="h-3.5 w-3.5" />
                                Open billing page
                            </a>
                        </div>
                    </div>
                    <button
                        onClick={onDismiss}
                        className="p-1 hover:bg-amber-500/15 rounded text-muted-foreground"
                        title="Dismiss"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full rounded-lg p-4 mb-4 border shadow-sm bg-destructive/10 border-destructive/40">
            <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />

                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <h3 className="text-sm font-medium text-destructive">Error</h3>
                            {error.context && (
                                <span className="text-xs bg-destructive/15 text-destructive px-2 py-0.5 rounded-full">
                                    {error.context}
                                </span>
                            )}
                        </div>

                        <div className="flex items-center gap-1">
                            {detailedIssues.length > 0 && (
                                <button
                                    onClick={() => setIsExpanded(!isExpanded)}
                                    className="p-1 hover:bg-destructive/15 rounded text-destructive"
                                    title={isExpanded ? 'Collapse' : 'Expand'}
                                >
                                    {isExpanded ? (
                                        <ChevronUp className="h-4 w-4" />
                                    ) : (
                                        <ChevronDown className="h-4 w-4" />
                                    )}
                                </button>
                            )}

                            <CopyButton
                                value={fullErrorText}
                                tooltip="Copy error"
                                className="p-1 hover:bg-destructive/15 rounded text-destructive"
                                size={16}
                            />

                            <SpeakButton
                                value={fullErrorText}
                                tooltip="Read error"
                                className="p-1 hover:bg-destructive/15 rounded text-destructive"
                            />

                            <button
                                onClick={onDismiss}
                                className="p-1 hover:bg-destructive/15 rounded text-destructive"
                                title="Dismiss"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                    </div>

                    <div className="mt-2 text-sm text-destructive">{error.message}</div>

                    {isExpanded && detailedIssues.length > 0 && (
                        <div className="mt-3">
                            <div className="text-xs text-destructive bg-destructive/10 p-3 rounded border border-destructive/30 overflow-auto max-h-60">
                                {detailedIssues.map((issue: Issue, index: number) => (
                                    <div key={index} className="mb-2 last:mb-0">
                                        <div className="font-medium">{issue.message}</div>
                                        {issue.context != null && (
                                            <div className="text-destructive/70 mt-1">
                                                {typeof issue.context === 'string'
                                                    ? issue.context
                                                    : JSON.stringify(issue.context, null, 2)}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
