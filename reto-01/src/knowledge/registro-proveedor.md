# Conocimiento del proceso

- Países y equivalentes tributarios: CO → NIT; EC → RUC; PE → RUC; PA → RUC; HN → RTN.
- El maestro solo contiene la identificación tributaria colombiana. Para EC, PE, PA o HN se propone el NIT como referencia, pero debe marcarse `requiere_confirmacion` con nota `identificador extranjero`.
- Los sinónimos se resuelven mediante `fixtures/reto-01/glosario-campos.json`.
- Los datos bancarios solo se incluyen cuando la plantilla pide explícitamente un campo bancario.
- Soportes vencidos o ausentes bloquean `listo_para_firma`. Campos faltantes se reportan y no bloquean por sí solos.
- No se ejecutan envíos, firmas ni operaciones en portales reales. El envío es únicamente una simulación local.
