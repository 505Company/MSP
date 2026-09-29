import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.editable.worker.mjs";

export interface PdfProbeResult {
  pages: number;
  text: string;
  operatorCount: number;
}

export function configurePdfWorker(): void {
  (globalThis as typeof globalThis & {
    pdfjsWorker?: { WorkerMessageHandler: typeof WorkerMessageHandler };
  }).pdfjsWorker = { WorkerMessageHandler };
  GlobalWorkerOptions.workerPort = null;
}

export function disposePdfWorker(): void {
  GlobalWorkerOptions.workerPort = null;
  delete (globalThis as typeof globalThis & { pdfjsWorker?: unknown }).pdfjsWorker;
}

export async function probePdfBytes(bytes: Uint8Array): Promise<PdfProbeResult> {
  const task = getDocument({
    data: bytes.slice(),
    enableXfa: false,
    stopAtErrors: true,
    useSystemFonts: true,
    useWasm: false,
    useWorkerFetch: false,
  });
  const document = await task.promise;
  try {
    const page = await document.getPage(1);
    const [textContent, operators] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
    return {
      pages: document.numPages,
      text: textContent.items
        .map((item) => ("str" in item ? item.str : ""))
        .filter(Boolean)
        .join(" "),
      operatorCount: operators.fnArray.length,
    };
  } finally {
    await task.destroy();
  }
}
