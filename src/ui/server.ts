import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server';
import { createServerEntry } from '@tanstack/react-start/server-entry';
import { withClientDisconnectHandling } from './lib/client-disconnect';

export default createServerEntry({ fetch: withClientDisconnectHandling(createStartHandler(defaultStreamHandler)) });
