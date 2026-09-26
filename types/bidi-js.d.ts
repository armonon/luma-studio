declare module "bidi-js" {
  export type Embedding = { levels: Uint8Array; paragraphs: { start: number; end: number; level: number }[] };
  export default function bidiFactory(): {
    getEmbeddingLevels(text: string, direction?: "ltr" | "rtl" | "auto"): Embedding;
    getReorderedIndices(text: string, embedding: Embedding): number[];
  };
}
