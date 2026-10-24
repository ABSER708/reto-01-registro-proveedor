import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { leer_solicitud, mapear_campos, generar_formulario, armar_paquete } from "./src/tools/proveedor.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const ctx = { directory: root, sessionId: "demo-determinista" };
const output = path.join(root, "out");
await fs.rm(output, { recursive: true, force: true }); await fs.mkdir(output, { recursive: true });
const casesDir = path.join(root, "fixtures", "reto-01", "casos");
const caseDirs = (await fs.readdir(casesDir, { withFileTypes: true })).filter(x => x.isDirectory()).map(x => x.name).sort();
function parse(raw: string): { ok: boolean; data?: Record<string, unknown>; error?: string } { return JSON.parse(raw) as { ok: boolean; data?: Record<string, unknown>; error?: string }; }
for (const caso of caseDirs) {
  try {
    const read = parse(await leer_solicitud.execute({ caso }, ctx));
    if (!read.ok || !read.data) { console.log(`✗ ${caso}: ${read.error}`); continue; }
    const fields = read.data.campos as Array<{ etiqueta: string; hoja?: string; celda?: string; obligatorio?: boolean }>;
    const mapped = parse(await mapear_campos.execute({ caso, campos: fields }, ctx));
    if (!mapped.ok || !mapped.data) { console.log(`✗ ${caso}: ${mapped.error}`); continue; }
    const form = parse(await generar_formulario.execute({ caso, mapeo: mapped.data as never }, ctx));
    const pack = parse(await armar_paquete.execute({ caso }, ctx));
    console.log(`${form.ok && pack.ok ? "✓" : "✗"} ${caso} | formato=${String(read.data.formato)} | llenos=${(mapped.data.llenos as unknown[]).length} | faltantes=${(mapped.data.faltantes as unknown[]).length} | confirmación=${(mapped.data.requiere_confirmacion as unknown[]).length} | listo_para_firma=${String(pack.data?.listo_para_firma)} | salida=${String(form.data?.ruta)}`);
  } catch (error) { console.log(`✗ ${caso}: ${error instanceof Error ? error.message : "Error inesperado"}`); }
}
console.log(`\nVerificación completada para ${caseDirs.length} casos. No se consumió ningún modelo de IA.`);
