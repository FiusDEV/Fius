import { useEffect } from 'react';

export function SpeechReset() {
    useEffect(() => {
        const cancel = () => {
            try {
                if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
                    window.speechSynthesis.cancel();
                }
            } catch {}
        };

        cancel();

        const onVisibilityChange = () => {
            if (document.visibilityState === 'hidden') cancel();
        };

        window.addEventListener('pagehide', cancel);
        window.addEventListener('beforeunload', cancel);
        document.addEventListener('visibilitychange', onVisibilityChange);

        return () => {
            window.removeEventListener('pagehide', cancel);
            window.removeEventListener('beforeunload', cancel);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, []);

    return null;
}
