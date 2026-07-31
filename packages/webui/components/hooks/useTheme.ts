import { useEffect, useState } from 'react';

export function useTheme() {
    const [theme, setTheme] = useState<'light' | 'dark'>(() => {
        if (typeof document !== 'undefined') {
            return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
        }
        return 'dark';
    });

    useEffect(() => {
        if (typeof document === 'undefined') return;
        document.documentElement.classList.toggle('dark', theme === 'dark');
        try {
            localStorage.setItem('theme', theme);
            const isSecure =
                typeof window !== 'undefined' && window.location?.protocol === 'https:';
            document.cookie = `theme=${encodeURIComponent(theme)}; path=/; max-age=31536000; SameSite=Lax${isSecure ? '; Secure' : ''}`;
        } catch {
        }
    }, [theme]);

    const toggleTheme = (checked: boolean) => {
        setTheme(checked ? 'dark' : 'light');
    };

    return { theme, toggleTheme, hasMounted: true } as const;
}
