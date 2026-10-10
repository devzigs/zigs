// C interface of the Rust engine (wasm/src/ffi.rs).
#pragma once

// Runs one engine method. `args` is a JSON array. Returns {"ok": "..."} or {"err": "..."}.
// Free the result with zf_free.
char *zf_call(const char *method, const char *args);
void zf_free(char *result);
