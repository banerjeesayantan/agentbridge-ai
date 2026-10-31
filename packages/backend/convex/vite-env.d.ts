interface ImportMeta {
  glob(
    patterns: string | string[],
    options?: {
      eager?: boolean;
      import?: string;
      query?: string;
    },
  ): Record<string, () => Promise<unknown>>;
}