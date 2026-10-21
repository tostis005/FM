// Identificadores de ruta ligeros: no se importa una pantalla completa
// para comprobar qué sección corresponde a la URL.
export const REAL_SECTION_MAP={
 "compras-preparador":"pedidos","compras-pendientes":"pedidos","compras-pedidos":"pedidos",
 "oportunidades-seguimiento":"oportunidades","alertas":"trabajo","mi-trabajo":"trabajo",
 "stock-traspasos":"traspasos","rentabilidad-retorno":"resultados"
};
export const REAL_SECTIONS=new Set(Object.keys(REAL_SECTION_MAP));
export const DOCUMENT_SCREENS=new Set([
 "productos","ventas-tickets","ventas-devoluciones","compras-recepciones","compras-devoluciones","stock-historico",
 "proveedores-condiciones","rentabilidad-segmentos"
]);
