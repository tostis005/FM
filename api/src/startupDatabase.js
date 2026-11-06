// El esquema de producción ya se migra durante el despliegue. No repetir DDL
// bloqueante sobre ventas y artículos en cada arranque de la API. Las nuevas
// instalaciones mantienen el camino de bootstrap anterior.
export async function needsStartupMigrations(pool){
 const {rows}=await pool.query({
  text:`SELECT (
   to_regclass('farmetrica.pedidos_laboratorio_borradores') IS NOT NULL
   AND to_regclass('farmetrica.preparador_frecuencia_laboratorio') IS NOT NULL
   AND to_regclass('farmetrica.proveedores_unificados_alias') IS NOT NULL
   AND to_regclass('ampedia.fm_ventas_lineas') IS NOT NULL
   AND to_regclass('ampedia.fm_ventas_analitica') IS NOT NULL
  ) AS initialized`,
  query_timeout:5000
 });
 return rows[0]?.initialized!==true;
}
