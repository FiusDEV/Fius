import { useParams } from '@tanstack/react-router';
import { Helmet } from 'react-helmet-async';
import ChatApp from '@/components/ChatApp';

export function ChatPage() {
    const { sessionId } = useParams({ from: '/chat/$sessionId' });

    return (
        <>
            <Helmet>
                <title>Fius Web</title>
                <meta name="description" content={`Chat session ${sessionId}`} />
            </Helmet>
            <ChatApp sessionId={sessionId} />
        </>
    );
}
