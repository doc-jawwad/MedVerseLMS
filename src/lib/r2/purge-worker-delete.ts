import "server-only";

import {
  deleteR2Object,
  getR2Config,
  type R2Config,
} from "@/lib/r2/presign";

/** Bound R2 DELETE for cron / workers. 404 is treated as success by deleteR2Object. */
export function createDefaultR2Delete(
  config?: R2Config
): (objectKey: string) => Promise<{ error?: string }> {
  return async (objectKey: string) => {
    const cfg = config ?? getR2Config();
    if ("error" in cfg) return { error: cfg.error };
    return deleteR2Object({ key: objectKey, config: cfg });
  };
}
