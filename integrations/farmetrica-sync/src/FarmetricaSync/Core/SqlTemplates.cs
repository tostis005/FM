namespace FarmetricaSync.Core;

public sealed record SourceQueryTemplate(string SystemType, string Entity, string Title, string Sql, string FullSql,
    string PreferredMode = "incremental", string Note = "",
    int SuggestedReplayMinutes = 180, int SuggestedEveryMinutes = 60);
public static class SqlTemplates
{
    // No sumar descuentos de naturaleza desconocida (importe frente a porcentaje).
    private const string SalesSelect = """
SELECT
    CONCAT(CONVERT(varchar(50), v.Empresa), '|',
           CONVERT(varchar(50), v.IdVenta), '|',
           CONVERT(varchar(50), v.IdNLinea)) AS origen_id,
    v.FechaHora AS fecha,
    CONVERT(varchar(100), v.Codigo) AS articulo_id,
    CAST(v.Cantidad AS decimal(18,4)) AS unidades,
    CAST(v.Pvp AS decimal(18,4)) AS precio_unitario,
    CAST(v.ImporteNeto AS decimal(18,4)) AS importe,
    CONVERT(varchar(100), v.NumeroDoc) AS numero_ticket,
    CAST(v.DescuentoLinea AS decimal(18,4)) AS descuento_linea,
    CAST(v.DescuentoOpera AS decimal(18,4)) AS descuento_operacion
FROM {{TABLE:dbo.vLineaVenta}} AS v
""";
    // Reparación estricta de la plantilla v0.7: FROM ... AS vWHERE v.FechaHora.
    // No modificar SQL personalizado que no contenga exactamente ese patrón.
    public static string RepairFarmaticSalesIncremental(string sql) =>
        System.Text.RegularExpressions.Regex.Replace(sql,
            @"\bAS\s+vWHERE(?=\s+v\.FechaHora\s*>=\s*@desde\b)",
            "AS v\nWHERE", System.Text.RegularExpressions.RegexOptions.IgnoreCase);

    // Contrato único vRecep para las cinco farmacias: solo columnas compartidas.
    // No usar Descuento2: no está presente en todas las instalaciones Farmatic.
    // Cabeceras únicamente: no inventar importes, unidades o artículos por línea.
    private const string ReceptionHeaders = """
SELECT
    CONVERT(varchar(100), r.IdRecepcion) AS origen_id,
    TRY_CONVERT(datetime2, r.Fecha) AS fecha,
    CAST(NULL AS varchar(100)) AS articulo_id,
    CONVERT(varchar(100), r.XProv_IdProveedor) AS proveedor_id,
    CAST(NULL AS decimal(18,4)) AS unidades,
    CAST(NULL AS decimal(18,4)) AS coste_unitario,
    CAST(NULL AS decimal(18,4)) AS importe,
    CONVERT(varchar(60), r.Hora) AS hora_recepcion,
    TRY_CONVERT(datetime2, r.Hora) AS fecha_hora_recepcion,
    CONVERT(varchar(100), r.NPedido) AS numero_pedido,
    CONVERT(varchar(100), r.IdAlbaran) AS albaran_id,
    CONVERT(varchar(100), r.XCPro_IdCondicion) AS condicion_id,
    CONVERT(varchar(100), r.XVend_IdVendedor) AS vendedor_id,
    TRY_CONVERT(bit, r.Actualizado) AS recepcion_actualizada,
    TRY_CONVERT(bit, r.Demorada) AS recepcion_demorada,
    CONVERT(nvarchar(255), r.FIS_NOMBRE) AS proveedor_nombre,
    CONVERT(nvarchar(2000), r.Descripcion) AS descripcion
FROM {{TABLE:dbo.vRecep}} AS r
""";

    // Fecha es la fecha comercial, no necesariamente FechaAlta. El intervalo por
    // días completos y la relectura no garantizan altas retroactivas: reconciliar.
    private static string ReceptionIncremental => ReceptionHeaders.TrimEnd() +
        "\nWHERE r.Fecha >= CONVERT(date, @desde) AND r.Fecha < CONVERT(date, @hasta)";

    // Las consultas guardadas pueden utilizar el antiguo SELECT con Descuento2.
    // No cambiar automáticamente consultas personalizadas; solo al pulsar "Actualizar
    // desde esquema" se reemplazan ambos SELECT de forma deliberada.
    public static string NormalizeForMode(string systemType, string entity, string mode, string sql) =>
        systemType.Equals("farmatic", StringComparison.OrdinalIgnoreCase) &&
        entity.Equals("compras", StringComparison.OrdinalIgnoreCase) &&
        mode.Equals("incremental", StringComparison.OrdinalIgnoreCase) &&
        sql.Trim().Equals(ReceptionHeaders.Trim(), StringComparison.Ordinal)
            ? ReceptionIncremental : sql;

    public static void ValidateKnownSourceColumns(string systemType, string entity, string mode, string sql)
    {
        if (!systemType.Equals("farmatic", StringComparison.OrdinalIgnoreCase) ||
            !entity.Equals("compras", StringComparison.OrdinalIgnoreCase)) return;
        if (System.Text.RegularExpressions.Regex.IsMatch(sql, @"\bFechaHora\b",
                System.Text.RegularExpressions.RegexOptions.IgnoreCase))
            throw new ArgumentException("Farmatic dbo.vRecep no tiene FechaHora. Usa Fecha y Hora separados o actualiza desde esquema.");
        if (System.Text.RegularExpressions.Regex.IsMatch(sql, @"\bDescuento2\b",
                System.Text.RegularExpressions.RegexOptions.IgnoreCase))
            throw new ArgumentException("Descuento2 no es común a las cinco farmacias. Pulsa 'Actualizar desde esquema' para utilizar el SELECT unificado de recepciones.");
    }

    // IdArticu es un ID interno. NO presumimos que sea CN ni código de barras.
    // Ni EAN ni CN aparecen como columnas en el SELECT del origen facilitado.
    private const string ArticlesSnapshot = """
SELECT
    CONVERT(varchar(100), a.IdArticu) AS origen_id,
    CONVERT(nvarchar(500), a.Descripcion) AS nombre,
    CAST(NULL AS varchar(30)) AS codigo_nacional,
    CAST(NULL AS varchar(30)) AS ean,
    CONVERT(varchar(100), a.XFam_IdFamilia) AS familia,
    CONVERT(nvarchar(255), a.Laboratorio) AS laboratorio,
    TRY_CONVERT(decimal(18,4), a.Pvp) AS pvp,
    CONVERT(nvarchar(500), a.Presentacion) AS presentacion,
    CONVERT(varchar(100), a.Situacion) AS situacion,
    TRY_CONVERT(decimal(18,4), a.Puc) AS puc,
    TRY_CONVERT(decimal(18,4), a.Pmc) AS pmc,
    CONVERT(varchar(100), a.ProveedorHabitual) AS proveedor_habitual_id,
    TRY_CONVERT(datetime2, a.FechaUltimaEntrada) AS fecha_ultima_entrada,
    TRY_CONVERT(datetime2, a.FechaUltimaSalida) AS fecha_ultima_salida,
    CAST(NULL AS varchar(50)) AS segmento_comercial,
    CAST(NULL AS varchar(100)) AS subcategoria,
    CAST(NULL AS varchar(40)) AS clasificacion_origen,
    CAST(NULL AS decimal(18,4)) AS clasificacion_confianza,
    CAST(NULL AS varchar(12)) AS cn_normalizado,
    TRY_CONVERT(decimal(18,4), a.StockActual) AS stock_actual,
    TRY_CONVERT(decimal(18,4), a.StockMinimo) AS stock_minimo,
    TRY_CONVERT(decimal(18,4), a.StockMaximo) AS stock_maximo,
    TRY_CONVERT(decimal(18,4), a.LoteOptimo) AS lote_optimo
FROM {{TABLE:dbo.Articu}} AS a
""";

    // Si el origen de artículos usa exactamente la plantilla estándar antigua,
    // ampliar el SELECT sin eliminar el trabajo ni su estado. Consultas SQL personalizadas
    // permanecen intactas y tienen acción explícita "Actualizar desde esquema".
    public static string UpgradeStandardArticleSql(string sql)
    {
        // Actualizar solo plantillas que reconozcamos como antiguas. Las
        // consultas manuales nunca se sobrescriben automáticamente.
        const string classification = """
    CAST(NULL AS varchar(50)) AS segmento_comercial,
    CAST(NULL AS varchar(100)) AS subcategoria,
    CAST(NULL AS varchar(40)) AS clasificacion_origen,
    CAST(NULL AS decimal(18,4)) AS clasificacion_confianza,
    CAST(NULL AS varchar(12)) AS cn_normalizado,
""";
        var previous = ArticlesSnapshot.Replace(classification + "\n", "");
        var previousWithoutStock = previous.Replace(
            "    TRY_CONVERT(datetime2, a.FechaUltimaSalida) AS fecha_ultima_salida,\n" +
            "    TRY_CONVERT(decimal(18,4), a.StockActual) AS stock_actual,\n" +
            "    TRY_CONVERT(decimal(18,4), a.StockMinimo) AS stock_minimo,\n" +
            "    TRY_CONVERT(decimal(18,4), a.StockMaximo) AS stock_maximo,\n" +
            "    TRY_CONVERT(decimal(18,4), a.LoteOptimo) AS lote_optimo",
            "    TRY_CONVERT(datetime2, a.FechaUltimaSalida) AS fecha_ultima_salida");
        return sql.Trim().Equals(previous.Trim(), StringComparison.Ordinal) ||
               sql.Trim().Equals(previousWithoutStock.Trim(), StringComparison.Ordinal)
            ? ArticlesSnapshot.TrimEnd() : sql;
    }

    // Nunca extraer cuentas bancarias ni información personal que no sea necesaria
    // para el maestro comercial. FIS_* son datos fiscales/profesionales.
    private const string SuppliersSnapshot = """
SELECT
    CONVERT(varchar(100), p.IDPROVEEDOR) AS origen_id,
    CONVERT(nvarchar(255), p.FIS_NOMBRE) AS nombre,
    CONVERT(varchar(100), p.FIS_NIF) AS nif,
    CONVERT(varchar(100), p.FIS_TELEFONO) AS telefono,
    CAST(NULL AS varchar(255)) AS email,
    CONVERT(nvarchar(500), p.FIS_DIRECCION) AS direccion,
    CONVERT(varchar(30), p.FIS_CODPOSTAL) AS codigo_postal,
    CONVERT(nvarchar(255), p.FIS_POBLACION) AS poblacion,
    CONVERT(nvarchar(255), p.FIS_PROVINCIA) AS provincia,
    CONVERT(nvarchar(500), p.Web) AS web,
    TRY_CONVERT(decimal(18,4), p.DESCUENTO) AS descuento
FROM {{TABLE:dbo.vProveedor}} AS p
""";

    // Una sola fila por IdFamilia, de existir unicidad en Familia/FamiliaAux.
    // LEFT JOIN mantiene familias sin correspondencia o superfamilia asignada.
    // Toda la clasificación es local a cada farmacia y se relaciona por
    // articulos.familia = familias.origen_id + farmacia_codigo.
    private const string FamiliesSnapshot = """
SELECT
    CONVERT(varchar(100), f.IdFamilia) AS origen_id,
    LTRIM(RTRIM(CONVERT(nvarchar(500), f.Descripcion))) AS nombre,
    CONVERT(varchar(100), fa.IdSuperFamilia) AS superfamilia_id,
    LTRIM(RTRIM(CONVERT(nvarchar(500), sf.Descripcion))) AS superfamilia_nombre,
    TRY_CONVERT(decimal(18,4), f.Coef1) AS coeficiente_1,
    TRY_CONVERT(decimal(18,4), f.Coef2) AS coeficiente_2,
    TRY_CONVERT(decimal(18,4), f.FactorDtoCredito) AS factor_descuento_credito,
    TRY_CONVERT(decimal(18,4), f.desviacion) AS desviacion,
    CONVERT(varchar(100), f.XGrup_IdGrupoIva) AS grupo_iva_id,
    TRY_CONVERT(bit, f.DeducibleHacienda) AS deducible_hacienda,
    CONVERT(varchar(100), f.GRUPOFORMU) AS grupo_formulacion,
    CONVERT(varchar(100), f.Empresa) AS empresa,
    CONVERT(nvarchar(1000), f.InfoEspecial) AS informacion_especial
FROM {{TABLE:dbo.Familia}} AS f
LEFT JOIN {{TABLE:dbo.FamiliaAux}} AS fa
    ON fa.IdFamilia = f.IdFamilia
LEFT JOIN {{TABLE:dbo.SuperFamilia}} AS sf
    ON sf.IdSuperFamilia = fa.IdSuperFamilia
""";

    // Campos añadidos al contrato en esta versión. Permitir NULL solamente para
    // estos campos en SELECT anteriores, sin relajar la validación del resto.
    private static readonly IReadOnlyDictionary<string, HashSet<string>> LegacyOptional = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase)
    {
        ["ventas"] = new(StringComparer.OrdinalIgnoreCase) { "descuento_linea", "descuento_operacion" },
        ["compras"] = new(StringComparer.OrdinalIgnoreCase) { "hora_recepcion", "fecha_hora_recepcion", "numero_pedido", "albaran_id", "condicion_id", "proveedor_nombre", "descripcion", "vendedor_id", "recepcion_actualizada", "recepcion_demorada" },
        ["articulos"] = new(StringComparer.OrdinalIgnoreCase) { "presentacion", "situacion", "puc", "pmc", "proveedor_habitual_id", "fecha_ultima_entrada", "fecha_ultima_salida", "segmento_comercial", "subcategoria", "clasificacion_origen", "clasificacion_confianza", "cn_normalizado" },
        ["proveedores"] = new(StringComparer.OrdinalIgnoreCase) { "direccion", "codigo_postal", "poblacion", "provincia", "web", "descuento" }
    };
    public static bool IsLegacyOptional(string entity, string column) =>
        LegacyOptional.TryGetValue(entity, out var names) && names.Contains(column);

    public static IReadOnlyList<SourceQueryTemplate> All { get; } =
    [
        new("farmatic", "ventas", "Farmatic · líneas de venta (vLineaVenta)",
            SalesSelect.TrimEnd() + "\nWHERE v.FechaHora >= @desde AND v.FechaHora < @hasta", SalesSelect.TrimEnd()),
        new("farmatic", "compras", "Farmatic · cabeceras de recepción (vRecep)",
            ReceptionIncremental, ReceptionHeaders.TrimEnd(), "incremental",
            "Una sola plantilla para las cinco farmacias, sin Descuento2. Solo cabeceras (no hay líneas/importe por artículo). Incremental por Fecha comercial en días completos, con relectura de 7 días: las recepciones registradas con fechas anteriores pueden omitirse; reconciliar con cargas completas periódicas.", 10080, 1440),
        new("farmatic", "articulos", "Farmatic · catálogo de artículos (Articu)",
            ArticlesSnapshot.TrimEnd(), ArticlesSnapshot.TrimEnd(), "snapshot",
            "IdArticu es identificador interno. Catálogo y stock_actual, stock_minimo, stock_maximo, lote_optimo en una única carga de Articu. No inferir CN ni EAN si no están en el origen."),
        new("farmatic", "familias", "Farmatic · familias y superfamilias (Familia/FamiliaAux/SuperFamilia)",
            FamiliesSnapshot.TrimEnd(), FamiliesSnapshot.TrimEnd(), "snapshot",
            "Una única consulta completa diaria. Relación con articulos.familia mediante IdFamilia y farmacia_codigo. Permite familias sin superfamilia. Si un IdFamilia se duplica en una farmacia, se bloquea la importación para evitar asignaciones erróneas.", 180, 1440),
        new("farmatic", "proveedores", "Farmatic · maestro de proveedores (vProveedor)",
            SuppliersSnapshot.TrimEnd(), SuppliersSnapshot.TrimEnd(), "snapshot",
            "Carga completa que detecta altas, cambios y bajas. No incluye datos bancarios.")
    ];
}
