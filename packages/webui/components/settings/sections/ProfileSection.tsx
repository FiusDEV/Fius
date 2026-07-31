import { useFiusAuth } from '../../hooks/useFiusAuth';
import { User, Mail, CreditCard, ExternalLink } from 'lucide-react';

const PLAN_LABELS: Record<string, string> = {
    free: 'Free',
    pro: 'Pro',
    team: 'Team',
};

export function ProfileSection() {
    const { data: auth } = useFiusAuth();

    return (
        <div className="space-y-6">
            <div className="rounded-lg border border-border bg-card p-4 space-y-4">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <User className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                        <p className="text-sm font-medium">{auth?.email || 'Unknown'}</p>
                        <p className="text-xs text-muted-foreground">Logged in</p>
                    </div>
                </div>

                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Mail className="h-4 w-4" />
                    <span>{auth?.email || 'Not available'}</span>
                </div>

                <div className="flex items-center gap-2 text-sm">
                    <CreditCard className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Plan:</span>
                    <span className="font-medium">
                        {auth?.plan ? `Fius ${PLAN_LABELS[auth.plan] || auth.plan}` : 'Free'}
                    </span>
                </div>
            </div>

            <a
                href="https://fius.dev/workspace"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
                <ExternalLink className="h-4 w-4" />
                Open billing page
            </a>
        </div>
    );
}
