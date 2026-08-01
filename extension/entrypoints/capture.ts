import { startCapture } from '../utils/capture.ts';

// This module is emitted as a standalone IIFE. CRXJS's `?script` import resolves
// to that generated file, so injection executes the capture entry immediately.
if (typeof location !== 'undefined' && typeof document !== 'undefined') void startCapture();
