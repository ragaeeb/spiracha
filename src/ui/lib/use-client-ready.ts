import { useEffect, useState } from 'react';

export const useClientReady = (): boolean => {
    const [ready, setReady] = useState(false);
    useEffect(() => setReady(true), []);
    return ready;
};
