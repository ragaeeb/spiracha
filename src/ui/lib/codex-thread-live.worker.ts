import { createCodexThreadLiveHub } from './codex-thread-live-hub';

const hub = createCodexThreadLiveHub();
const workerScope = globalThis as unknown as {
    onconnect: ((event: MessageEvent) => void) | null;
};

workerScope.onconnect = (event) => {
    for (const port of event.ports) {
        hub.connect(port);
    }
};
