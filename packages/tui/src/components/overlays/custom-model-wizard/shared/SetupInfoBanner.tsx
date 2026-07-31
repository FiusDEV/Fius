

import React from 'react';
import { Box, Text } from 'ink';

interface SetupInfoBannerProps {
    
    title: string;
    
    description: string;
    
    docsUrl?: string | undefined;
}


export function SetupInfoBanner({
    title,
    description,
    docsUrl,
}: SetupInfoBannerProps): React.ReactElement {
    return (
        <Box flexDirection="column" marginBottom={1}>
            <Text color="blue">ℹ {title}</Text>
            <Text color="gray">{description}</Text>
            {docsUrl && <Text color="gray">Setup guide: {docsUrl}</Text>}
        </Box>
    );
}

export default SetupInfoBanner;
