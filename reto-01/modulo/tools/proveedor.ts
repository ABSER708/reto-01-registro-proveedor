// Reexporta las herramientas canónicas para evitar divergencias entre la app y el módulo.
export {
  leer_solicitud,
  mapear_campos,
  generar_formulario,
  armar_paquete,
  simular_envio,
  toolRegistry,
  toolSchemas,
} from "../../src/tools/proveedor.js";
export type { ToolContext, ToolName } from "../../src/tools/proveedor.js";
