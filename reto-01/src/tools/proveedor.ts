import { z } from "zod";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import PDFDocument from "pdfkit";

export type ToolContext = { directory: string; sessionId: string };
type ToolResult = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };
type ToolDefinition = { description: string; args: z.ZodRawShape; execute: (args: never, ctx: ToolContext) => Promise<string> };
const Caso = z.string().min(1).max(100).regex(/^[a-z0-9-]+$/).describe("Nombre exacto del caso dentro de fixtures/reto-01/casos");
const json = async (file: string): Promise<unknown> => JSON.parse(await fs.readFile(file, "utf8"));
const rootPath = (ctx: ToolContext, ...parts: string[]): string => path.join(ctx.directory, ...parts);
const caseDir = (ctx: ToolContext, caso: string): string => rootPath(ctx, "fixtures", "reto-01", "casos", caso);
const exists = async (file: string): Promise<boolean> => fs.access(file).then(() => true).catch(() => false);
const result = (value: ToolResult): string => JSON.stringify(value);
async function logged<T extends Record<string, unknown>>(name: string, ctx: ToolContext, operation: () => Promise<T>, caso?: string): Promise<string> {
  try {
    const data = await operation();
    const entry = { ts: new Date().toISOString(), herramienta: name, ok: true, resumen: Object.keys(data).join(", ") };
    const logPath = rootPath(ctx, "out", "logs", `${ctx.sessionId}.jsonl`);
    await fs.mkdir(path.dirname(logPath), { recursive: true }); await fs.appendFile(logPath, `${JSON.stringify(entry)}\n`);
    if (caso) { const caseLog = rootPath(ctx, "out", caso, "log.jsonl"); await fs.mkdir(path.dirname(caseLog), { recursive: true }); await fs.appendFile(caseLog, `${JSON.stringify(entry)}\n`); }
    return result({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado";
    const entry = { ts: new Date().toISOString(), herramienta: name, ok: false, resumen: message };
    const logPath = rootPath(ctx, "out", "logs", `${ctx.sessionId}.jsonl`);
    await fs.mkdir(path.dirname(logPath), { recursive: true }); await fs.appendFile(logPath, `${JSON.stringify(entry)}\n`).catch(() => undefined);
    if (caso) { const caseLog = rootPath(ctx, "out", caso, "log.jsonl"); await fs.mkdir(path.dirname(caseLog), { recursive: true }); await fs.appendFile(caseLog, `${JSON.stringify(entry)}\n`).catch(() => undefined); }
    return result({ ok: false, error: message });
  }
}
function valueAt(source: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((current, part) => current && typeof current === "object" ? (current as Record<string, unknown>)[part] : undefined, source);
}
function normalize(value: string): string { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function asText(value: unknown): string { if (value === undefined || value === null || value === "") return ""; if (typeof value === "object") return JSON.stringify(value); return String(value); }

export const leer_solicitud = {
  description: "Lee la solicitud, plantilla y soportes exigidos de un caso de registro de proveedor.",
  args: { caso: Caso },
  async execute(args: { caso: string }, ctx: ToolContext): Promise<string> {
    return logged("proveedor_leer_solicitud", ctx, async () => {
      const dir = caseDir(ctx, args.caso);
      const solicitud = await json(path.join(dir, "solicitud.json")) as Record<string, unknown>;
      const formato = solicitud.formato;
      const plantillaFile = formato === "xlsx" ? "plantilla-celdas.json" : formato === "pdf" ? "plantilla-campos.json" : "";
      const plantilla = plantillaFile && await exists(path.join(dir, plantillaFile)) ? await json(path.join(dir, plantillaFile)) as Array<Record<string, unknown>> : [];
      const soportes = await json(path.join(dir, "soportes-exigidos.json")) as string[];
      if (formato === "xlsx") return { caso: args.caso, cliente: solicitud.cliente, pais: solicitud.pais, formato, campos: plantilla.map(x => ({ etiqueta: x.etiqueta, hoja: x.hoja, celda: x.celda_valor })), soportes, solicitud: { id: solicitud.id, asunto: solicitud.asunto, fecha: solicitud.fecha, cuerpo: solicitud.cuerpo } };
      if (formato === "pdf") return { caso: args.caso, cliente: solicitud.cliente, pais: solicitud.pais, formato, campos: plantilla.map(x => ({ etiqueta: x.etiqueta, obligatorio: x.obligatorio })), soportes, solicitud: { id: solicitud.id, asunto: solicitud.asunto, fecha: solicitud.fecha, cuerpo: solicitud.cuerpo } };
      return { caso: args.caso, cliente: solicitud.cliente, pais: solicitud.pais, formato, campos: [], soportes, solicitud: { id: solicitud.id, asunto: solicitud.asunto, fecha: solicitud.fecha, cuerpo: solicitud.cuerpo } };
    }, args.caso);
  }
};

export const mapear_campos = {
  description: "Cruza los campos de la plantilla con el maestro y el glosario, sin inventar valores.",
  args: { caso: Caso, campos: z.array(z.object({ etiqueta: z.string().min(1), hoja: z.string().optional(), celda: z.string().optional(), obligatorio: z.boolean().optional() })).describe("Campos devueltos por proveedor_leer_solicitud") },
  async execute(args: { caso: string; campos: Array<{ etiqueta: string; hoja?: string; celda?: string; obligatorio?: boolean }> }, ctx: ToolContext): Promise<string> {
    return logged("proveedor_mapear_campos", ctx, async () => {
      const maestro = await json(rootPath(ctx, "fixtures", "reto-01", "repositorio", "maestro.json"));
      const glossary = await json(rootPath(ctx, "fixtures", "reto-01", "glosario-campos.json")) as Record<string, string>;
      const byNorm = new Map(Object.entries(glossary).map(([label, key]) => [normalize(label), key]));
      const llenos: Array<Record<string, unknown>> = [], faltantes: Array<Record<string, unknown>> = [], requiere_confirmacion: Array<Record<string, unknown>> = [];
      const solicitud = await json(path.join(caseDir(ctx, args.caso), "solicitud.json")) as Record<string, unknown>;
      const country = String(solicitud.pais ?? "CO");
      for (const field of args.campos) {
        const key = byNorm.get(normalize(field.etiqueta));
        if (!key) { faltantes.push({ etiqueta: field.etiqueta, obligatorio: field.obligatorio ?? true, motivo: "No existe un sinónimo en el glosario." }); continue; }
        const value = valueAt(maestro, key);
        if (value === undefined || value === null || value === "") { faltantes.push({ etiqueta: field.etiqueta, clave_maestro: key, obligatorio: field.obligatorio ?? true, motivo: "El dato no existe en el maestro." }); continue; }
        const item = { etiqueta: field.etiqueta, clave_maestro: key, valor: asText(value), hoja: field.hoja, celda: field.celda, obligatorio: field.obligatorio ?? true };
        if (key === "nit" && country !== "CO") requiere_confirmacion.push({ ...item, nota: "identificador extranjero", propuesta: `El maestro solo contiene el NIT colombiano; confirme el identificador tributario para ${country}.` });
        else llenos.push(item);
      }
      return { caso: args.caso, llenos, faltantes, requiere_confirmacion };
    }, args.caso);
  }
};

export const generar_formulario = {
  description: "Genera el formulario de salida en XLSX o PDF; para portal genera valores copiabes en Markdown.",
  args: { caso: Caso, mapeo: z.object({ llenos: z.array(z.record(z.unknown())), faltantes: z.array(z.record(z.unknown())), requiere_confirmacion: z.array(z.record(z.unknown())) }).describe("Resultado de proveedor_mapear_campos") },
  async execute(args: { caso: string; mapeo: { llenos: Array<Record<string, unknown>>; faltantes: Array<Record<string, unknown>>; requiere_confirmacion: Array<Record<string, unknown>> } }, ctx: ToolContext): Promise<string> {
    return logged("proveedor_generar_formulario", ctx, async () => {
      const solicitud = await json(path.join(caseDir(ctx, args.caso), "solicitud.json")) as Record<string, unknown>;
      const outDir = rootPath(ctx, "out", args.caso); await fs.mkdir(outDir, { recursive: true });
      const fmt = String(solicitud.formato);
      if (fmt === "xlsx") {
        const wb = XLSX.utils.book_new(); const sheets = new Map<string, Array<Array<string>>>();
        const template = await json(path.join(caseDir(ctx, args.caso), "plantilla-celdas.json")) as Array<{ hoja: string; celda_etiqueta: string; etiqueta: string; celda_valor: string }>;
        for (const item of template) {
          const rows = sheets.get(item.hoja) ?? []; sheets.set(item.hoja, rows);
          const mapped = args.mapeo.llenos.find(x => normalize(String(x.etiqueta)) === normalize(item.etiqueta));
          const confirm = args.mapeo.requiere_confirmacion.find(x => normalize(String(x.etiqueta)) === normalize(item.etiqueta));
          const row = Number(item.celda_valor.match(/\d+/)?.[0] ?? 1) - 1; while (rows.length <= row) rows.push([]);
          const colLabel = XLSX.utils.decode_cell(item.celda_etiqueta).c, colValue = XLSX.utils.decode_cell(item.celda_valor).c;
          while (rows[row].length <= Math.max(colLabel, colValue)) rows[row].push("");
          rows[row][colLabel] = item.etiqueta; rows[row][colValue] = String(mapped?.valor ?? (confirm ? `PENDIENTE CONFIRMACIÓN: ${String(confirm.valor ?? "")}` : "PENDIENTE: dato faltante"));
        }
        for (const [name, rows] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name.slice(0, 31));
        const file = path.join(outDir, "formulario.xlsx"); XLSX.writeFile(wb, file);
        return { ruta: `out/${args.caso}/formulario.xlsx`, formato: "xlsx", campos_faltantes: args.mapeo.faltantes.length, requieren_confirmacion: args.mapeo.requiere_confirmacion.length };
      }
      if (fmt === "pdf") {
        const template = await json(path.join(caseDir(ctx, args.caso), "plantilla-campos.json")) as Array<{ etiqueta: string; obligatorio: boolean }>;
        const file = path.join(outDir, "formulario.pdf");
        await new Promise<void>((resolve, reject) => {
          const doc = new PDFDocument({ margin: 50, size: "A4" }); const stream = requireStream(file, resolve, reject); doc.pipe(stream);
          doc.fontSize(18).text(`Formulario de registro de proveedor`, { align: "center" }); doc.moveDown(); doc.fontSize(10).text(`Cliente: ${String(solicitud.cliente)} | País: ${String(solicitud.pais)}`); doc.moveDown();
          for (const field of template) {
            const mapped = args.mapeo.llenos.find(x => normalize(String(x.etiqueta)) === normalize(field.etiqueta));
            const confirm = args.mapeo.requiere_confirmacion.find(x => normalize(String(x.etiqueta)) === normalize(field.etiqueta));
            const value = mapped?.valor ?? (confirm ? `PENDIENTE CONFIRMACIÓN: ${String(confirm.valor ?? "")}` : "PENDIENTE: dato faltante");
            doc.fontSize(10).font("Helvetica-Bold").text(field.etiqueta); doc.font("Helvetica").text(String(value)); doc.moveDown(0.5);
          }
          doc.end();
        });
        return { ruta: `out/${args.caso}/formulario.pdf`, formato: "pdf", campos_faltantes: args.mapeo.faltantes.length, requieren_confirmacion: args.mapeo.requiere_confirmacion.length };
      }
      const lines = [`# Valores para portal web — ${String(solicitud.cliente)}`, "", "Formato portal no automatizado. Copie y revise los valores manualmente.", "", ...args.mapeo.llenos.map(x => `- **${String(x.etiqueta)}:** ${String(x.valor)}`), ...args.mapeo.requiere_confirmacion.map(x => `- **${String(x.etiqueta)}:** REQUIERE CONFIRMACIÓN — ${String(x.nota)}`), ...args.mapeo.faltantes.map(x => `- **${String(x.etiqueta)}:** FALTANTE — ${String(x.motivo)}`)];
      await fs.writeFile(path.join(outDir, "valores-portal.md"), lines.join("\n"));
      return { ruta: `out/${args.caso}/valores-portal.md`, formato: "portal_no_soportado", campos_faltantes: args.mapeo.faltantes.length, requieren_confirmacion: args.mapeo.requiere_confirmacion.length };
    }, args.caso);
  }
};
function requireStream(file: string, resolve: () => void, reject: (error: Error) => void) {
  // Importación dinámica para mantener la escritura de PDF basada en streams nativos.
  const stream = createWriteStream(file);
  stream.on("finish", resolve); stream.on("error", reject); return stream;
}

export const armar_paquete = {
  description: "Copia los soportes exigidos y crea checklist y borrador de correo para revisión humana.",
  args: { caso: Caso },
  async execute(args: { caso: string }, ctx: ToolContext): Promise<string> {
    return logged("proveedor_armar_paquete", ctx, async () => {
      const solicitud = await json(path.join(caseDir(ctx, args.caso), "solicitud.json")) as Record<string, unknown>;
      const required = await json(path.join(caseDir(ctx, args.caso), "soportes-exigidos.json")) as string[];
      const supportIndex = await json(rootPath(ctx, "fixtures", "reto-01", "repositorio", "soportes", "index.json")) as Array<{ tipo: string; archivo: string; vigencia_hasta: string | null; descripcion: string }>;
      const packageDir = rootPath(ctx, "out", args.caso, "paquete"); await fs.mkdir(packageDir, { recursive: true });
      const today = new Date().toISOString().slice(0, 10); const checklist: Array<{ tipo: string; estado: string; detalle: string }> = [];
      for (const type of required) {
        const item = supportIndex.find(x => normalize(x.tipo) === normalize(type) || normalize(x.descripcion).includes(normalize(type)) || normalize(type).includes(normalize(x.tipo)));
        if (!item) { checklist.push({ tipo: type, estado: "ausente", detalle: "No existe un soporte coincidente en el índice." }); continue; }
        const source = rootPath(ctx, "fixtures", "reto-01", "repositorio", "soportes", item.archivo);
        if (!(await exists(source))) { checklist.push({ tipo: type, estado: "ausente", detalle: `No se encontró el archivo ${item.archivo}.` }); continue; }
        const expired = Boolean(item.vigencia_hasta && item.vigencia_hasta < today);
        await fs.copyFile(source, path.join(packageDir, item.archivo));
        checklist.push({ tipo: type, estado: expired ? "vencido" : "presente", detalle: `${item.descripcion}${item.vigencia_hasta ? ` (vigencia hasta ${item.vigencia_hasta})` : " (sin vencimiento registrado)"}` });
      }
      const checklistText = [`# Checklist de soportes — ${String(solicitud.cliente)}`, "", `Fecha de revisión: ${today}`, "", ...checklist.map(x => `- [${x.estado === "presente" ? "x" : " "}] **${x.tipo} — ${x.estado}:** ${x.detalle}`), "", "## Campos pendientes", "Revisar los faltantes y las solicitudes de confirmación reportadas en el chat antes de la firma."];
      await fs.writeFile(path.join(packageDir, "checklist.md"), checklistText.join("\n"));
      const email = `Asunto: Documentación para registro como proveedor — ${String(solicitud.cliente)}\n\nCordial saludo,\n\nAdjuntamos para revisión el formulario de registro como proveedor y los soportes disponibles. El formulario queda pendiente de validación y firma del representante legal.\n\nPor favor, validar los campos pendientes y la vigencia de los soportes antes de remitir al cliente.\n\nSaludos,\nEquipo administrativo\n`;
      await fs.writeFile(path.join(packageDir, "borrador-correo.md"), email);
      const ready = checklist.every(x => x.estado === "presente");
      const form = String(solicitud.formato) === "xlsx" ? "formulario.xlsx" : String(solicitud.formato) === "pdf" ? "formulario.pdf" : "valores-portal.md";
      const formPath = rootPath(ctx, "out", args.caso, form);
      if (await exists(formPath)) await fs.copyFile(formPath, path.join(packageDir, form));
      return { ruta: `out/${args.caso}/paquete`, listo_para_firma: ready, checklist, formulario: form };
    }, args.caso);
  }
};

export const simular_envio = {
  description: "Crea un registro local de envío simulado; requiere confirmación explícita del usuario.",
  args: { caso: Caso, confirmado: z.boolean().describe("Debe ser true únicamente tras confirmación explícita e inmediata del usuario") },
  async execute(args: { caso: string; confirmado: boolean }, ctx: ToolContext): Promise<string> {
    if (!args.confirmado) return result({ ok: false, error: "requiere confirmación explícita" });
    return logged("proveedor_simular_envio", ctx, async () => {
      const dir = rootPath(ctx, "out", args.caso); await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, "ENVIO-SIMULADO.md");
      await fs.writeFile(file, `# Envío simulado\n\nCaso: ${args.caso}\nFecha: ${new Date().toISOString()}\n\nNo se envió correo, no se firmó ningún documento y no se realizó ninguna operación externa.\n`);
      return { ruta: `out/${args.caso}/ENVIO-SIMULADO.md`, simulacion: true };
    }, args.caso);
  }
};

export const toolRegistry = { leer_solicitud, mapear_campos, generar_formulario, armar_paquete, simular_envio };
export type ToolName = keyof typeof toolRegistry;
export function getTool(name: string) { return Object.prototype.hasOwnProperty.call(toolRegistry, name) ? toolRegistry[name as ToolName] : undefined; }
export function toolSchemas() {
  return Object.entries(toolRegistry).map(([key, tool]) => ({ type: "function" as const, function: { name: `proveedor_${key}`, description: tool.description, parameters: zodToJsonSchema(z.object(tool.args as z.ZodRawShape)) } }));
}
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  // Conversión deliberadamente acotada al subconjunto Zod utilizado por estas herramientas.
  const s = schema as unknown as { _def: { typeName: string; shape?: () => Record<string, z.ZodTypeAny>; checks?: Array<{ kind: string; value?: number }> } };
  if (s._def.typeName === "ZodObject") {
    const shape = s._def.shape?.() ?? {}; const properties: Record<string, unknown> = {}; const required: string[] = [];
    for (const [key, child] of Object.entries(shape)) { properties[key] = zodToJsonSchema(child); if (!(child as unknown as { isOptional?: () => boolean }).isOptional?.()) required.push(key); }
    return { type: "object", properties, required, additionalProperties: false };
  }
  if (s._def.typeName === "ZodArray") return { type: "array", items: zodToJsonSchema((schema as z.ZodArray<z.ZodTypeAny>).element) };
  if (s._def.typeName === "ZodBoolean") return { type: "boolean", description: schema.description };
  if (s._def.typeName === "ZodString") return { type: "string", description: schema.description };
  if (s._def.typeName === "ZodNumber") return { type: "number", description: schema.description };
  if (s._def.typeName === "ZodOptional") return zodToJsonSchema((schema as z.ZodOptional<z.ZodTypeAny>).unwrap());
  if (s._def.typeName === "ZodRecord") return { type: "object", additionalProperties: true };
  return {};
}
