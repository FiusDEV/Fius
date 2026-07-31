import { useEffect, useState } from 'react';

export function useFontsReady(): boolean {
    const [ready, setReady] = useState(false);

    useEffect(() => {
        if (typeof document === 'undefined') return;

        const anyDoc = document as any;
        if (!anyDoc.fonts || !anyDoc.fonts.ready) {
            setReady(true);
            return;
        }

        let cancelled = false;
        anyDoc.fonts.ready.then(() => {
            if (!cancelled) setReady(true);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    return ready;
}
