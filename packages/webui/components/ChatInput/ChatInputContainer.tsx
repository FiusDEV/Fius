import React from 'react';
import { cn } from '@/lib/utils';

interface ChatInputContainerProps {
    children: React.ReactNode;
    className?: string;
}

export function ChatInputContainer({ children, className }: ChatInputContainerProps) {
    return (
        <div
            className={cn(
                'relative',
                'w-full',
                'flex flex-col overflow-visible',
                'max-h-[max(35svh,5rem)]',
                'border border-border/30',
                'bg-background',
                'rounded-3xl',
                'shadow-lg hover:shadow-xl',
                'transition-all duration-200',
                className
            )}
        >
            {children}
        </div>
    );
}
