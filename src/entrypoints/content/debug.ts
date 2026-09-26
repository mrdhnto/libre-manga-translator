import { storage } from "#imports";

const MAX_DEBUG_LOGS = 50;
const DEBUG_LOGS_KEY = "local:debug-logs";
const DEBUG_ENABLED_KEY = "local:debug-enabled";

export async function isDebugEnabled(): Promise<boolean> {
  try {
    return (await storage.getItem<boolean>(DEBUG_ENABLED_KEY)) ?? false;
  } catch {
    return false;
  }
}

export async function logDebugEntry(entry: DebugEntry): Promise<string> {
  const id = entry.id ?? crypto.randomUUID();
  try {
    const enabled = await storage.getItem<boolean>(DEBUG_ENABLED_KEY);
    if (!enabled) return id;
    const logs = (await storage.getItem<DebugEntry[]>(DEBUG_LOGS_KEY)) ?? [];
    logs.unshift({ ...entry, id });
    if (logs.length > MAX_DEBUG_LOGS) {
      logs.length = MAX_DEBUG_LOGS;
    }
    await storage.setItem(DEBUG_LOGS_KEY, logs);
  } catch (e) {
    console.error("LMT: Failed to write debug log", e);
  }
  return id;
}

export async function updateDebugEntry(
  id: string,
  patch: Partial<DebugEntry>,
): Promise<void> {
  try {
    const logs = (await storage.getItem<DebugEntry[]>(DEBUG_LOGS_KEY)) ?? [];
    const idx = logs.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const existing = logs[idx];
    const merged: DebugEntry = {
      ...existing,
      ...patch,
      timing: { ...existing.timing, ...(patch.timing ?? {}) },
      models: { ...existing.models, ...(patch.models ?? {}) },
    };
    if (existing.llmPerf || patch.llmPerf) {
      merged.llmPerf = { ...existing.llmPerf, ...(patch.llmPerf ?? {}) };
    }
    logs[idx] = merged;
    await storage.setItem(DEBUG_LOGS_KEY, logs);
  } catch (e) {
    console.error("LMT: Failed to update debug log", e);
  }
}

export async function getDebugLogs(): Promise<DebugEntry[]> {
  try {
    return (await storage.getItem<DebugEntry[]>(DEBUG_LOGS_KEY)) ?? [];
  } catch {
    return [];
  }
}

export async function clearDebugLogs(): Promise<void> {
  try {
    await storage.setItem(DEBUG_LOGS_KEY, []);
  } catch (e) {
    console.error("LMT: Failed to clear debug logs", e);
  }
}
