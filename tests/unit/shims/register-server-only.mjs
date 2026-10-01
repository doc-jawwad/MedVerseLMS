/**
 * Register a no-op resolution for the `server-only` package during unit tests.
 * Next.js still enforces the real package at build/bundle time.
 */
import { register } from "node:module";

register("./server-only-hooks.mjs", import.meta.url);
