"use client";

import { useCallback, useState } from "react";
import { errorMessage } from "./format";

/** Runs a mutation while tracking its pending state and any error message. */
export function useRun() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setPending(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    } finally {
      setPending(false);
    }
  }, []);

  return { run, pending, error };
}
