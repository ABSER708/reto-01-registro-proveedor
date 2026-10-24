# SOLUCION.md — Reto 01: Registro como proveedor

## 1. Problema en una frase

Preparar de forma repetible los formularios y soportes de registro de proveedores que una analista administrativa hoy transcribe manualmente, sin inventar datos y dejando firma y envío bajo control humano.

## 2. Arquitectura

```text
Frontend de chat (web/index.html)
   │ HTTP JSON
   ▼
Backend HTTP (src/server.ts)
   ├── Ciclo del agente, sesión y límite de iteraciones
   ├── Prompt de comportamiento (agent/prompt.md)
   ├── Adaptador de modelo (src/llm/adapter.ts + openai.ts)
   └── Herramientas tipadas (src/tools/proveedor.ts + Zod)
          ├── fixtures/ (solo lectura: solicitudes, maestro, glosario y soportes)
          └── out/ (formularios, paquete, simulación de envío y logs)
```

El comportamiento conversacional está en `agent/prompt.md`; el conocimiento estable del proceso está en `src/knowledge/registro-proveedor.md`; la ejecución determinista está en las herramientas. El frontend no contiene la clave del proveedor. Las herramientas son la fuente de datos y devuelven JSON con `{ ok, data }` o `{ ok: false, error }`.

## 3. Ciclo del agente

1. El frontend envía el mensaje y el identificador de sesión a `POST /api/chat`.
2. El backend conserva el historial en memoria y añade el system prompt.
3. El adaptador envía mensajes y definiciones de herramientas al modelo.
4. Si el modelo solicita herramientas, el backend valida argumentos con Zod, ejecuta la herramienta y añade su resultado al historial.
5. El ciclo vuelve al modelo hasta que responda o alcance `MAX_TOOL_ITERATIONS`.
6. El frontend muestra cada llamada, argumentos y resultado, además de destacar la confirmación humana.
7. `proveedor_simular_envio` solo escribe un archivo local; no hay integración de correo, firma ni portal real.

El límite evita ciclos indefinidos. Para producción también deben imponerse límites de tokens, presupuesto por usuario y límite de tasa. La sesión de este prototipo vive en memoria y se pierde al reiniciar el proceso.

## 4. Elección del modelo y costos

La implementación inicial utiliza OpenAI Chat Completions con un modelo configurable que soporte tool calling; el valor por defecto es `gpt-4o-mini`. Se elige por su costo relativamente bajo y capacidad para seleccionar herramientas. El proveedor se encapsula en `LlmAdapter` para que el ciclo del agente no dependa del SDK de un proveedor.

El costo exacto depende de la tarifa vigente, tokens de entrada/salida y número de iteraciones. Estimación reproducible:

`costo_caso = (tokens_entrada / 1.000.000 × tarifa_entrada) + (tokens_salida / 1.000.000 × tarifa_salida)`

Ejemplo ilustrativo, no cotización: si un caso consume 12.000 tokens de entrada y 2.000 de salida, sustituye en la fórmula las tarifas publicadas para el modelo que esté activo. Las herramientas y `demo.ts` no consumen tokens. Antes de la defensa se deben actualizar tarifas con la página oficial del proveedor y medir tokens reales de una ejecución representativa.

## 5. Portal web 

Para portales que no ofrecen API se priorizaría una API oficial. Como alternativa, un navegador controlado/RPA podría asistir a la persona, pero el flujo debe detenerse ante CAPTCHA, MFA, cambio de layout o discrepancia de datos. Las credenciales las ingresa el humano en un gestor de secretos o formulario seguro; nunca se guardan en fixtures, prompt, código, historial ni logs. El agente prepara y verifica valores; el humano inicia sesión, revisa cada campo y pulsa “Enviar”. En este reto solo se genera `valores-portal.md` para copiar manualmente.

## 6. Decisiones y trade-offs

1. **Herramientas deterministas para los datos.** Alternativa descartada: pedir al modelo que rellene los valores directamente. Se descarta porque facilita alucinaciones y dificulta la trazabilidad.
2. **Archivos locales y sesiones en memoria.** Alternativa descartada: base de datos. El PRD permite archivos y el alcance es una demo; para producción se necesitaría persistencia con control de acceso, cifrado y retención.
3. **Adaptador LLM propio.** Alternativa descartada: acoplar el ciclo al SDK en el servidor. La interfaz facilita sustituir proveedor sin reescribir la orquestación.
4. **Frontend HTML sin framework.** Alternativa descartada: React/Svelte. Reduce pasos de instalación para el prototipo; un producto real puede necesitar componentes, pruebas de accesibilidad y manejo de estado más robusto.
5. **Envío simulado con aprobación.** Alternativa descartada: integración real de correo. El reto prohíbe acciones externas y exige mantener al humano como responsable de firma y envío.

## 7. Supuestos

- Los datos del maestro y los fixtures son ficticios y se consideran fuente autorizada para la prueba.
- La fecha de evaluación de vigencia corresponde a la fecha local del sistema en ejecución.
- Los soportes exigidos se identifican por el tipo del índice; en producción se requiere un catálogo controlado de equivalencias por cliente/país.
- Un identificador tributario extranjero no se asume igual al NIT colombiano: se propone solo como referencia y se marca para confirmación.
- El PDF se genera de nuevo con campos etiquetados; no se modifica un AcroForm original.

## 8. Cobertura funcional

| Historia | Estado del prototipo | Pendiente para producción |
|---|---|---|
| HU-1 Leer solicitud y plantilla | Implementado para XLSX, PDF y portal | Manejo de adjuntos reales y plantillas corruptas más variadas |
| HU-2 Mapear campos | Implementado con glosario y faltantes | Umbral de confianza configurable y pruebas de equivalencias ampliadas |
| HU-3 Generar formulario | XLSX y PDF generados; portal como Markdown | Preservar estilos de una plantilla Excel original y validar PDFs con usuario |
| HU-4 Paquete para firma | Copia soportes, checklist y borrador | Checklist más estricto por vigencias, formatos y país emisor |
| HU-5 Errores | Errores de herramientas serializados | Pruebas de integración, observabilidad y políticas de reintento |
| Confirmación humana | Prompt y botón de confirmación | Reforzar autorización en servidor con estado de confirmación firmado/expirable |
| Registro de llamadas | JSONL por sesión y visualización en chat | Rotación, retención, redacción de datos sensibles |

## 9. Uso de IA

Se utilizó ChatGPT como asistente de desarrollo para estructurar el proyecto, este permitio las instrucciones necesarias para la ejecucion de los requerimientos solicitados, dependencias relacionadas a node.js en este caso con npm

## 10. Riesgos de producción y mitigación

- **Datos sensibles en logs:** redactar campos financieros y datos personales, cifrar almacenamiento y aplicar retención.
- **Prompt injection en correos/adjuntos:** tratar contenido como datos no confiables; las instrucciones del correo no pueden cambiar las políticas de herramientas.
- **Confirmación simulada débil:** vincular la aprobación a una acción concreta, un caso y un turno; exigir reautenticación en acciones reales.
- **Datos maestros desactualizados:** asignar propietario del dato y validaciones de vigencia.
- **Acceso público y consumo de API:** autenticación, rate limit, cuotas y límites de costo por sesión.
- **Fallos de proveedor:** timeout, mensajes claros, telemetría y política de reintento con idempotencia.
- **Archivos maliciosos o rutas manipuladas:** validación de nombres, límites de tamaño, no ejecutar archivos y mantener fixtures en solo lectura.