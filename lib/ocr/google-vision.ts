import "server-only";
import { GoogleAuth } from "google-auth-library";
import { MissingConfigError } from "@/lib/ai/errors";
import type { OcrPageResult, OcrProvider } from "./types";
import { buildLines, type VisionPage } from "./vision-lines";

const ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";

/**
 * Google Cloud Vision DOCUMENT_TEXT_DETECTION over REST.
 * Auth: Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS or
 * workload identity). Data processor for ORIGINAL pages — see PRIVACY.md.
 * NOTE: request/response shapes follow the v1 docs as known on 2026-11-05;
 * re-verify against live docs before production (DECISIONS §A).
 */
export class GoogleVisionOcr implements OcrProvider {
  readonly name = "google-vision";
  private auth: GoogleAuth | null = null;

  private client() {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.GOOGLE_CLOUD_PROJECT)
      throw new MissingConfigError("Google Cloud Vision OCR", [
        "GOOGLE_APPLICATION_CREDENTIALS",
        "GOOGLE_CLOUD_PROJECT",
      ]);
    this.auth ??= new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-vision"] });
    return this.auth.getClient();
  }

  async recognise(image: Buffer, opts: { languageHints: string[] }): Promise<OcrPageResult> {
    const client = await this.client();
    const res = await client.request<{
      responses?: { fullTextAnnotation?: { pages?: VisionPage[] }; error?: { message?: string; code?: number } }[];
    }>({
      url: ENDPOINT,
      method: "POST",
      headers: process.env.GOOGLE_CLOUD_PROJECT
        ? { "x-goog-user-project": process.env.GOOGLE_CLOUD_PROJECT }
        : undefined,
      data: {
        requests: [
          {
            image: { content: image.toString("base64") },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
            imageContext: { languageHints: opts.languageHints },
          },
        ],
      },
    });
    const r = res.data.responses?.[0];
    if (r?.error) throw new Error(`Vision OCR failed (${r.error.code ?? "?"})`);
    const page = r?.fullTextAnnotation?.pages?.[0];
    if (!page) return { width: 0, height: 0, lines: [], provider: this.name };
    return { width: page.width ?? 0, height: page.height ?? 0, lines: buildLines(page), provider: this.name };
  }
}

let ocr: OcrProvider | null = null;
export function getOcrProvider(): OcrProvider {
  ocr ??= new GoogleVisionOcr();
  return ocr;
}
