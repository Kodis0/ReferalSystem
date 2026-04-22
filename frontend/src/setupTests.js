/**
 * Runs before each test file (Create React App).
 * react-router v7 CJS bundles expect TextEncoder in the Jest/jsdom environment.
 */
import { TextDecoder, TextEncoder } from "util";

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder;
