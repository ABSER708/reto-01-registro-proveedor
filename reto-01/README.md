# Reto 01 — Agente conversacional de registro como proveedor

Prototipo independiente para preparar formularios de registro de proveedores usando los fixtures del reto. La aplicación separa prompt, conocimiento, herramientas, adaptador LLM y frontend. El agente no firma ni envía información real.

## Requisitos

- Node.js 20 o superior (o Bun compatible).
- Una clave de OpenAI para la experiencia conversacional completa. El script de demo no necesita clave.

## Arranque local

```bash
npm install
cp .env.example .env
# Edita .env y configura OPENAI_API_KEY y, opcionalmente, OPENAI_MODEL
npm run dev
```

Abre `http://localhost:3000`.

El backend carga `.env` mediante `dotenv/config`. No subas el archivo `.env` al repositorio.

## Verificación determinista sin modelo

```bash
npm run demo
```

Procesa todos los casos y llama directamente a las herramientas. Limpia `out/` al inicio. No requiere clave ni consume tokens.

## Endpoints

- `GET /api/health`: estado del backend y proveedor configurado, sin mostrar claves.
- `GET /api/cases`: casos disponibles.
- `POST /api/chat`: `{ "sessionId": "opcional", "message": "Procesa ec-corp-andina" }`.
- `GET /api/sessions/:id`: historial de sesión en memoria.

## Variables de entorno

- `OPENAI_API_KEY`: clave privada solo del backend.
- `OPENAI_MODEL`: modelo de chat con soporte para tool calling; por defecto `gpt-4o-mini`.
- `PORT`: puerto HTTP; por defecto `3000`.
- `MAX_TOOL_ITERATIONS`: máximo de iteraciones de herramientas por turno.
- `MAX_SESSION_MESSAGES`: reservado para limitar historial en una siguiente iteración del prototipo.

## Salida

Los artefactos se crean bajo `out/<caso>/`; los logs de herramientas se guardan en `out/logs/<sessionId>.jsonl`. No subas `.env`, `node_modules/` ni `out/` al repositorio.

## Despliegue

No se ha desplegado aún una URL pública. Para la entrega, despliega el backend y el frontend en un servicio que soporte Node 20 y configura `OPENAI_API_KEY` como secreto del servicio. No incluyas la clave en variables `VITE_*`, HTML ni en el repositorio. La URL debe verificarse manualmente después del despliegue.
