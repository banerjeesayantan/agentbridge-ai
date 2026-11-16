declare global {
  interface ImportMeta {
    glob<T = any>(pattern: string): Record<string, () => Promise<T>>;
  }
}

export {};

export const modules = import.meta.glob("./**/*.ts");