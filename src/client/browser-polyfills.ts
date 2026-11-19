import { Buffer } from 'buffer/';

// Beacon uses the Node Buffer global even in its browser modules.
const browserGlobals = globalThis as unknown as { Buffer?: typeof Buffer };
browserGlobals.Buffer ??= Buffer;
