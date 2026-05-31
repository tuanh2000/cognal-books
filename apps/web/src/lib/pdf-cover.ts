// Render page 1 of a PDF to a PNG blob, used as the cover thumbnail. Runs in
// the renderer (Electron/browser) so the backend needs no PDF rasteriser.
// pdf.js is imported dynamically so it only loads when a PDF is actually picked.
export async function renderPdfCover(file: File): Promise<Blob | null> {
  try {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    try {
      const page = await pdf.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 600 / base.width); // ~600px-wide thumbnail
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      await page.render({ canvasContext: ctx, viewport }).promise;
      return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    } finally {
      await pdf.destroy();
    }
  } catch {
    return null; // a missing cover is non-fatal; the card falls back to an icon
  }
}
