using FarmetricaSync.Core;

var template = SqlTemplates.All.Single(t => t.SystemType == "farmatic" && t.Entity == "ventas");
if (!template.Sql.Contains("AS v\nWHERE v.FechaHora >= @desde", StringComparison.Ordinal))
    throw new Exception("La plantilla Farmatic ventas debe separar AS v y WHERE con un salto de línea.");

if (template.Sql.Contains("vWHERE", StringComparison.OrdinalIgnoreCase))
    throw new Exception("La plantilla Farmatic ventas ha vuelto a producir vWHERE.");

if (!template.Sql.Contains("@hasta", StringComparison.Ordinal))
    throw new Exception("Falta el límite exclusivo @hasta.");

var broken = template.FullSql + "WHERE v.FechaHora >= @desde AND v.FechaHora < @hasta";
var repaired = SqlTemplates.RepairFarmaticSalesIncremental(broken);
if (!repaired.Contains("AS v\nWHERE", StringComparison.Ordinal) ||
    repaired.Contains("vWHERE", StringComparison.OrdinalIgnoreCase))
    throw new Exception("No se ha reparado la plantilla defectuosa guardada de v0.7.");

var custom = "SELECT origen_id FROM ventas WHERE vWHERE = 1";
if (SqlTemplates.RepairFarmaticSalesIncremental(custom) != custom)
    throw new Exception("La reparación no debe alterar SQL personalizado ajeno al problema.");

if (!template.FullSql.EndsWith("AS v", StringComparison.Ordinal))
    throw new Exception("La consulta completa de Farmatic ha cambiado inesperadamente.");


// Every built-in template must select every column of its normalized entity,
// independent of whether it is used through a linked server or a direct connection.
var entities = CanonicalEntities.Create().ToDictionary(e => e.Name);
foreach (var source in SqlTemplates.All)
{
    if (!entities.TryGetValue(source.Entity, out var definition))
        throw new Exception($"Plantilla {source.Entity}: entidad no declarada.");
    foreach (var column in definition.Columns)
    {
        var rx = new System.Text.RegularExpressions.Regex(
            @"\bAS\s+" + System.Text.RegularExpressions.Regex.Escape(column.Name) + @"\b",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (!rx.IsMatch(source.Sql) || !rx.IsMatch(source.FullSql))
            throw new Exception($"Plantilla {source.Entity}: falta columna AS {column.Name}.");
    }
    if (!source.Sql.StartsWith("SELECT", StringComparison.Ordinal) ||
        !source.Sql.Contains("{{TABLE:dbo.", StringComparison.Ordinal))
        throw new Exception($"Plantilla {source.Entity}: debe ser SELECT con macro SQL segura.");
}
foreach (var source in SqlTemplates.All.Where(t => t.Entity is "articulos" or "proveedores" or "familias" or "vendedores"))
{
    if (source.PreferredMode != "snapshot")
        throw new Exception($"{source.Entity}: debe proponer snapshot/reconciliación completa.");
    if (source.Sql.Contains("@desde", StringComparison.OrdinalIgnoreCase) ||
        source.Sql.Contains("@hasta", StringComparison.OrdinalIgnoreCase))
        throw new Exception($"{source.Entity}: no inventar un incremental sin fecha técnica.");
}
// Las cinco farmacias utilizan exactamente la misma consulta de recepciones.
var farmaticReceipt = SqlTemplates.All.Single(t => t.Entity == "compras");
if (farmaticReceipt.Sql.Contains("Descuento2", StringComparison.OrdinalIgnoreCase) ||
    farmaticReceipt.FullSql.Contains("Descuento2", StringComparison.OrdinalIgnoreCase))
    throw new Exception("La consulta uniforme no debe referenciar Descuento2.");
if (entities["compras"].Columns.Any(c => c.Name == "descuento_recepcion"))
    throw new Exception("descuento_recepcion no forma parte del contrato compras estándar.");
foreach (var (source, alias) in new[] {
    ("IdRecepcion", "origen_id"), ("Fecha", "fecha"), ("Hora", "fecha_hora_recepcion"),
    ("XProv_IdProveedor", "proveedor_id"), ("XCPro_IdCondicion", "condicion_id"),
    ("XVend_IdVendedor", "vendedor_id"), ("Actualizado", "recepcion_actualizada"),
    ("Demorada", "recepcion_demorada"), ("NPedido", "numero_pedido"),
    ("IdAlbaran", "albaran_id"), ("FIS_NOMBRE", "proveedor_nombre"),
    ("Descripcion", "descripcion") })
{
    if (!farmaticReceipt.FullSql.Contains("r."+source, StringComparison.OrdinalIgnoreCase) ||
        !farmaticReceipt.FullSql.Contains(" AS "+alias, StringComparison.OrdinalIgnoreCase))
        throw new Exception("Falta campo común de recepciones: "+source+" → "+alias);
}
if (farmaticReceipt.Sql != farmaticReceipt.FullSql +
    "\nWHERE r.Fecha >= CONVERT(date, @desde) AND r.Fecha < CONVERT(date, @hasta)")
    throw new Exception("Incremental y completa han de devolver los mismos alias y solo diferir en el filtro.");
if (!farmaticReceipt.Sql.Contains("TRY_CONVERT(datetime2, r.Hora) AS fecha_hora_recepcion", StringComparison.Ordinal))
    throw new Exception("Conservar la fecha/hora real de recepción.");
var receiptTemplate = SqlTemplates.All.Single(t => t.Entity == "compras");
if (receiptTemplate.PreferredMode != "incremental")
    throw new Exception("vRecep debe preconfigurar incremental por fecha de documento explícito.");
if (!receiptTemplate.Sql.Contains("WHERE r.Fecha >= CONVERT(date, @desde) AND r.Fecha < CONVERT(date, @hasta)",
        StringComparison.Ordinal))
    throw new Exception("El incremental vRecep debe filtrar únicamente días completos en Fecha.");
if (receiptTemplate.Sql.Contains("FechaHora", StringComparison.OrdinalIgnoreCase) ||
    receiptTemplate.Sql.Contains("WHERE r.Hora", StringComparison.OrdinalIgnoreCase))
    throw new Exception("No existe FechaHora en vRecep, ni un tipo de Hora verificado para cursor.");
if (receiptTemplate.SuggestedReplayMinutes < 1440)
    throw new Exception("El solapamiento por fecha de documento debe cubrir varios días.");
if (receiptTemplate.SuggestedEveryMinutes != 1440)
    throw new Exception("Al disponer solo de Fecha (día), las recepciones deben recomendar ejecución diaria.");
SqlTemplates.ValidateKnownSourceColumns("farmatic", "compras", "incremental", receiptTemplate.Sql);
try
{
    SqlTemplates.ValidateKnownSourceColumns("farmatic","compras","incremental",
        receiptTemplate.FullSql.Replace("FROM {{TABLE:dbo.vRecep}} AS r",
            "TRY_CONVERT(decimal(18,4), r.Descuento2) AS descuento_recepcion\nFROM {{TABLE:dbo.vRecep}} AS r"));
    throw new Exception("Se esperaba rechazo de Descuento2.");
}
catch (ArgumentException ex) when (ex.Message.Contains("Descuento2")) { }

try
{
    SqlTemplates.ValidateKnownSourceColumns("farmatic","compras","incremental",
        receiptTemplate.FullSql + "\nWHERE r.FechaHora >= @desde AND r.FechaHora < @hasta");
    throw new Exception("Se esperaba error por columna inexistente FechaHora.");
}
catch (ArgumentException ex) when (ex.Message.Contains("vRecep"))
{
    // Detectar antes de llamar al SQL Server, sin impedir el arranque del servicio.
}
var repairedReceipt = SqlTemplates.NormalizeForMode("farmatic","compras","incremental",receiptTemplate.FullSql);
if (repairedReceipt != receiptTemplate.Sql)
    throw new Exception("v0.9 guardado como incremental con snapshot debe migrar al SELECT parametrizado.");
if (SqlTemplates.NormalizeForMode("farmatic","compras","snapshot",receiptTemplate.FullSql) != receiptTemplate.FullSql)
    throw new Exception("No se debe alterar la foto completa de recepciones.");
var customReceiptSql = receiptTemplate.FullSql + "\nWHERE r.NPedido IS NOT NULL";
if (SqlTemplates.NormalizeForMode("farmatic","compras","incremental",customReceiptSql) != customReceiptSql)
    throw new Exception("No se debe modificar un SQL personalizado de recepciones.");
if (SqlTemplates.NormalizeForMode("farmatic","ventas","incremental",receiptTemplate.FullSql) != receiptTemplate.FullSql)
    throw new Exception("La normalización no debe afectar otras entidades.");
var receipt = SqlTemplates.All.Single(t => t.Entity == "compras").Sql;
foreach (var alias in new[] { "articulo_id", "unidades", "coste_unitario", "importe" })
    if (!System.Text.RegularExpressions.Regex.IsMatch(receipt,
            @"CAST\(NULL AS .+?\)\s+AS\s+" + alias, System.Text.RegularExpressions.RegexOptions.IgnoreCase))
        throw new Exception("vRecep no debe inventar datos de línea: " + alias);
if (SqlTemplates.All.Any(t => t.Entity == "stock") || entities.ContainsKey("stock"))
    throw new Exception("Stock ya no debe existir como entidad independiente ni plantilla.");
var articulo = SqlTemplates.All.Single(t => t.Entity == "articulos").Sql;
if (!articulo.Contains("CAST(NULL AS varchar(30)) AS codigo_nacional") ||
    !articulo.Contains("CAST(NULL AS varchar(30)) AS ean"))
    throw new Exception("No inferir códigos nacionales o EAN de IdArticu.");
var suppliers = SqlTemplates.All.Single(t => t.Entity == "proveedores").Sql;
if (suppliers.Contains("CuentaBancoPago", StringComparison.OrdinalIgnoreCase) ||
    suppliers.Contains("PER_NIF", StringComparison.OrdinalIgnoreCase))
    throw new Exception("Excluir cuenta bancaria y datos personales no necesarios.");
foreach (var (source, alias) in new[] {
    ("StockActual", "stock_actual"), ("StockMinimo","stock_minimo"),
    ("StockMaximo","stock_maximo"), ("LoteOptimo","lote_optimo") })
{
    if (!articulo.Contains("a."+source, StringComparison.OrdinalIgnoreCase) ||
        !articulo.Contains(" AS "+alias, StringComparison.OrdinalIgnoreCase) ||
        !entities["articulos"].Columns.Any(c=>c.Name==alias&&c.Type=="numeric"))
        throw new Exception("La columna de existencias debe integrarse en artículos: "+alias);
}
if (SqlTemplates.IsLegacyOptional("articulos", "stock_actual") ||
    SqlTemplates.IsLegacyOptional("articulos", "stock_minimo"))
    throw new Exception("Las cantidades de existencias son obligatorias en los SELECT de artículos, no se deben importar como NULL por omisión.");
if (SqlTemplates.All.Count != 8 || entities.Count != 8 ||
    !entities.ContainsKey("ventas_completas") || !entities.ContainsKey("recepciones_completas"))
    throw new Exception("Ocho plantillas Farmatic: seis catálogos/movimientos y dos JOIN documentales.");

var tickets = SqlTemplates.All.Single(t => t.Entity == "ventas_completas");
var receipts = SqlTemplates.All.Single(t => t.Entity == "recepciones_completas");

if (!tickets.FullSql.Contains("CONVERT(varchar(100), l.TipoLinea) AS tipo_linea_origen") ||
    !tickets.FullSql.Contains("NULLIF(LTRIM(RTRIM(CONVERT(varchar(100), l.Codigo))), '') AS articulo_id"))
    throw new Exception("La plantilla debe permitir Codigo vacío sin fabricar artículos y conservar TipoLinea.");
if (!SqlTemplates.IsLegacyOptional("ventas_completas","tipo_linea_origen"))
    throw new Exception("SQL personalizado antiguo debe conservar compatibilidad de columnas.");
var oldStandardFull = tickets.FullSql.Replace(
    "NULLIF(LTRIM(RTRIM(CONVERT(varchar(100), l.Codigo))), '') AS articulo_id,\n" +
    "    CONVERT(varchar(100), l.TipoLinea) AS tipo_linea_origen,",
    "CONVERT(varchar(100), l.Codigo) AS articulo_id,");
var oldStandardIncremental = oldStandardFull +
    "\nWHERE v.FechaHora >= @desde AND v.FechaHora < @hasta";
if (SqlTemplates.UpgradeStandardSalesDocumentsSql(oldStandardFull) != tickets.FullSql ||
    SqlTemplates.UpgradeStandardSalesDocumentsSql(oldStandardIncremental) != tickets.Sql)
    throw new Exception("Actualización in situ de estándar anterior sin perder trabajo ni cursor.");
var customFull = oldStandardFull + "\nWHERE v.NumeroDoc IS NOT NULL";
if (SqlTemplates.UpgradeStandardSalesDocumentsSql(customFull) != customFull)
    throw new Exception("Nunca sustituir un SELECT personalizado.");

foreach (var (source, tables, requiredParts) in new[] {
    (tickets, new[] {"dbo.Venta", "dbo.LineaVenta"}, new[] {
        "l.IdVenta = v.IdVenta", "v.Empresa", "l.IdNLinea", "v.TotalVenta",
        "v.DescuentoOpera", "v.TotalCuota", "l.Codigo", "l.Cantidad",
        "l.PVP", "l.ImporteNeto", "l.DescuentoLinea"}),
    (receipts, new[] {"dbo.Recep", "dbo.LINEARECEP"}, new[] {
        "l.IdRecepcion = r.IdRecepcion", "l.IdNLinea", "l.XArt_IdArticu",
        "l.Recibidas", "l.UBonificar", "l.ImportePuc", "l.Importe", "l.Baja"})
}) {
    foreach (var table in tables)
        if (!source.FullSql.Contains("{{TABLE:"+table+"}}", StringComparison.Ordinal))
            throw new Exception("Flujo JOIN sin origen confirmado: "+table);
    foreach (var part in requiredParts)
        if (!source.FullSql.Contains(part, StringComparison.Ordinal))
            throw new Exception("Flujo JOIN con asignación incompleta: "+part);
    if (source.PreferredMode != "incremental" || source.SuggestedReplayMinutes < 10080 ||
        source.SuggestedEveryMinutes != 1440 || source.Sql == source.FullSql)
        throw new Exception("Releer 7 días como mínimo hasta encontrar fecha técnica de modificación.");
    if (!source.FullSql.Contains("LEFT JOIN", StringComparison.Ordinal) ||
        source.FullSql.Contains("@desde", StringComparison.OrdinalIgnoreCase) ||
        !source.Sql.Contains("@desde", StringComparison.Ordinal) ||
        !source.Sql.Contains("@hasta", StringComparison.Ordinal))
        throw new Exception("JOIN debe conservar documentos sin detalle y tener un SELECT completo aparte.");
}
if (!tickets.FullSql.Contains("l.ImporteNeto) AS importe_neto") ||
    !tickets.FullSql.Contains("l.DescuentoLinea) AS descuento_linea") ||
    !tickets.FullSql.Contains("v.DescuentoOpera) AS descuento_global"))
    throw new Exception("El descuento de operación no puede aplicarse dos veces.");
if (!receipts.FullSql.Contains("CAST(NULL AS decimal(20,6)) AS descuento_linea") ||
    !receipts.FullSql.Contains("CAST(NULL AS decimal(20,6)) AS total_documento") ||
    !receipts.FullSql.Contains("CAST(NULL AS varchar(100)) AS numero_pedido") ||
    !receipts.FullSql.Contains("l.UBonificar) AS bonificacion_unidades"))
    throw new Exception("No inventar descuentos y totales ausentes en Recep; preservar bonificaciones.");
if (receipts.FullSql.Contains("r.NPedido", StringComparison.OrdinalIgnoreCase) ||
    receipts.FullSql.Contains("r.Descuento2", StringComparison.OrdinalIgnoreCase))
    throw new Exception("Esas columnas no existen en la cabecera Recep confirmada.");
const string classification = """
    CAST(NULL AS varchar(50)) AS segmento_comercial,
    CAST(NULL AS varchar(100)) AS subcategoria,
    CAST(NULL AS varchar(40)) AS clasificacion_origen,
    CAST(NULL AS decimal(18,4)) AS clasificacion_confianza,
    CAST(NULL AS varchar(12)) AS cn_normalizado,
""";
var previousArticleSql = articulo.Replace(classification + "\n", "");
var legacyArticleSql=previousArticleSql.Replace(
    "    TRY_CONVERT(datetime2, a.FechaUltimaSalida) AS fecha_ultima_salida,\n" +
    "    TRY_CONVERT(decimal(18,4), a.StockActual) AS stock_actual,\n" +
    "    TRY_CONVERT(decimal(18,4), a.StockMinimo) AS stock_minimo,\n" +
    "    TRY_CONVERT(decimal(18,4), a.StockMaximo) AS stock_maximo,\n" +
    "    TRY_CONVERT(decimal(18,4), a.LoteOptimo) AS lote_optimo",
    "    TRY_CONVERT(datetime2, a.FechaUltimaSalida) AS fecha_ultima_salida");
if (SqlTemplates.UpgradeStandardArticleSql(previousArticleSql) != articulo ||
    SqlTemplates.UpgradeStandardArticleSql(legacyArticleSql) != articulo)
    throw new Exception("Las plantillas conocidas de artículos deben migrarse sin borrar trabajos.");

if (SqlTemplates.UpgradeStandardArticleSql("SELECT origen_id FROM personalizado") != "SELECT origen_id FROM personalizado")
    throw new Exception("No se debe sobrescribir SQL personalizado de artículos.");
// Catálogo Vendedor: nombres NO son clave y ColorVentas no es RGB inferido.
var sellers = SqlTemplates.All.Single(t => t.SystemType=="farmatic" && t.Entity=="vendedores");
if (sellers.PreferredMode!="snapshot" || sellers.SuggestedEveryMinutes!=1440 ||
    sellers.Sql!=sellers.FullSql || sellers.Sql.Contains("@desde") || sellers.Sql.Contains("@hasta"))
    throw new Exception("Vendedor: fotografía completa diaria sin fecha técnica.");
foreach (var (col, type) in new[] {
    ("origen_id","text"),("nombre","text"),("tipo","text"),("color_ventas","integer")
})
{
    if (!entities["vendedores"].Columns.Any(c=>c.Name==col&&c.Type==type))
        throw new Exception("Contrato vendedores incompleto: "+col);
    if (!System.Text.RegularExpressions.Regex.IsMatch(sellers.Sql,
        @"\bAS\s+"+col+@"\b",System.Text.RegularExpressions.RegexOptions.IgnoreCase))
        throw new Exception("SELECT Vendedor carece de alias: "+col);
}
if (!sellers.Sql.Contains("{{TABLE:dbo.Vendedor}} AS v") ||
    !sellers.Sql.Contains("v.IDVENDEDOR") ||
    !sellers.Sql.Contains("v.NOMBRE") ||
    !sellers.Sql.Contains("v.TIPO") ||
    !sellers.Sql.Contains("v.ColorVentas") ||
    sellers.Sql.Contains("WHERE") ||
    sellers.Sql.Contains("ORDER BY NOMBRE"))
    throw new Exception("Vendedor: clave técnica y cuatro columnas de origen deben preservarse.");
if (!SqlTemplates.All.Single(t=>t.Entity=="ventas_completas").FullSql.Contains("v.XVend_IdVendedor") ||
    !SqlTemplates.All.Single(t=>t.Entity=="recepciones_completas").FullSql.Contains("r.XVend_IdVendedor"))
    throw new Exception("Relación del vendedor por XVend_IdVendedor pendiente de contrato.");

// Familias: coincidencia de alias, tipos y relaciones entre las tres fuentes.
var family = SqlTemplates.All.Single(t => t.Entity == "familias");
if (family.PreferredMode != "snapshot" || family.SuggestedEveryMinutes != 1440)
    throw new Exception("Las familias requieren una carga completa diaria.");
if (family.Sql != family.FullSql || family.Sql.Contains("@desde") || family.Sql.Contains("@hasta"))
    throw new Exception("Una única consulta de familias sin fecha incremental.");
foreach (var table in new[] {"dbo.Familia", "dbo.FamiliaAux", "dbo.SuperFamilia"})
    if (!family.Sql.Contains("{{TABLE:"+table+"}}", StringComparison.Ordinal))
        throw new Exception("Falta tabla de familias: "+table);
if (System.Text.RegularExpressions.Regex.Matches(family.Sql, @"\bLEFT JOIN\b",
    System.Text.RegularExpressions.RegexOptions.IgnoreCase).Count != 2)
    throw new Exception("Las familias sin superfamilia deben conservarse con LEFT JOIN.");
foreach (var (column, type) in new[] {
    ("origen_id","text"),("nombre","text"),("superfamilia_id","text"),
    ("superfamilia_nombre","text"),("coeficiente_1","numeric"),
    ("coeficiente_2","numeric"),("factor_descuento_credito","numeric"),
    ("desviacion","numeric"),("grupo_iva_id","text"),
    ("deducible_hacienda","bool"),("grupo_formulacion","text"),
    ("empresa","text"),("informacion_especial","text")
})
    if (!entities["familias"].Columns.Any(c=>c.Name==column && c.Type==type))
        throw new Exception($"Campo normalizado de familias ausente: {column} ({type}).");
if (!entities["articulos"].Columns.Any(c=>c.Name=="familia" && c.Type=="text"))
    throw new Exception("Falta vinculación a Articu.XFam_IdFamilia en artículos.");
if (!family.FullSql.Contains("fa.IdFamilia = f.IdFamilia", StringComparison.Ordinal) ||
    !family.FullSql.Contains("sf.IdSuperFamilia = fa.IdSuperFamilia", StringComparison.Ordinal))
    throw new Exception("Relaciones Familia-FamiliaAux-SuperFamilia incorrectas.");
if (!family.FullSql.Contains("f.XGrup_IdGrupoIva) AS grupo_iva_id", StringComparison.Ordinal))
    throw new Exception("Conservar el código de grupo de IVA en texto, por ejemplo 02.");
Console.WriteLine("OK: 8 plantillas Farmatic, vendedores por ID, JOIN documentales y catálogos.");

