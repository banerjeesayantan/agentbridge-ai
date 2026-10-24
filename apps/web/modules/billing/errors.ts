import { ConvexError } from "convex/values";

export interface AppErrorData {
  code?: string;
  message?: string;
  [key: string]: unknown;
}

/** Structured backend error data, if the error came from a ConvexError. */
export const getErrorData = (error: unknown): AppErrorData | null => {
  if (error instanceof ConvexError && typeof error.data === "object" && error.data !== null) {
    return error.data as AppErrorData;
  }
  return null;
};

/** User-facing text: the backend's own message for known errors, else a fallback. */
export const getErrorMessage = (error: unknown, fallback = "Something went wrong"): string =>
  getErrorData(error)?.message || fallback;

export const isLimitError = (error: unknown) => {
  const code = getErrorData(error)?.code;
  return code === "LIMIT_REACHED" || code === "PLAN_REQUIRED";
};
