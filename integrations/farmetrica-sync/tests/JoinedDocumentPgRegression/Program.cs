using FarmetricaSync.Core;
using FarmetricaSync.Data;
using Npgsql;

var url = Environment.GetEnvironmentVariable("FM_TEST_NPGSQL")
    ?? throw new Exception("FM_TEST_NPGSQL es obligatorio");
await using var db = new NpgsqlConnection(url);
await db.OpenAsync();
var pharmacy = new Pharmacy { Code = "ABA", SystemType = "farmatic" };
var sales = CanonicalEntities.Create().Single(e => e.Name == "ventas_completas");
var receipts = CanonicalEntities.Create().Single(e => e.Name == "recepciones_completas");
static Dictionary<string, object?> Row(EntityDefinition entity,
    string origin, string doc, string? line, decimal total,
    decimal? quantity = null, decimal? net = null, string? product = null)
{
    var row = entity.Columns.ToDictionary(c => c.Name, _ => (object?)null);
    row["origen_id"] = origin;
    row["documento_id"] = doc;
    row["linea_id"] = line;
    row["fecha"] = new DateTime(2026,10,19,11,45,0);
    row["estado"] = "valido";
    row["total_documento"] = total;
    row["descuento_global"] = 1m;
    row["numero_documento"] = "ABC-001";
    row["tercero_id"] = "PROVEEDOR";
    row["unidades"] = quantity;
    row["importe_neto"] = net;
    row["articulo_id"] = product;
    return row;
}
static async IAsyncEnumerable<IReadOnlyList<Dictionary<string, object?>>> Batches(
    params Dictionary<string, object?>[] rows)
{
    yield return rows;
    await Task.CompletedTask;
}
static async Task<long> Count(NpgsqlConnection connection, string query)
{
    await using var cmd = new NpgsqlCommand(query,connection);
    return Convert.ToInt64(await cmd.ExecuteScalarAsync());
}
static void Check(bool ok, string reason)
{
    if (!ok) throw new Exception(reason);
}
var doc="JOIN-VALIDATE-2026";
var first = Row(sales,"J-1",doc,"1",15.15m,2,25.15m,"ART-1");
var second = Row(sales,"J-2",doc,"2",15.15m,-1,-10m,"ART-2");
var result = await JoinedDocumentWriter.WriteAsync(db,"ampedia",pharmacy,sales,
    Batches(first,second),null,CancellationToken.None);
Check(result.Rows==2 && result.Inserted==3,"Insertar una cabecera y dos líneas");
Check(await Count(db,"SELECT count(*) FROM ampedia.fm_ventas_lineas WHERE documento_id='JOIN-VALIDATE-2026'")==2,
    "Faltan líneas");
var idempotent = await JoinedDocumentWriter.WriteAsync(db,"ampedia",pharmacy,sales,
    Batches(first,second),null,CancellationToken.None);
Check(idempotent.Inserted==0 && idempotent.Updated==0,"Repetir es idempotente");
var corrected = Row(sales,"J-1",doc,"1",14.25m,2,25.15m,"ART-1");
var corrected2 = Row(sales,"J-2",doc,"2",14.25m,-1,-10m,"ART-2");
var change = await JoinedDocumentWriter.WriteAsync(db,"ampedia",pharmacy,sales,
    Batches(corrected,corrected2),null,CancellationToken.None);
Check(change.Inserted==0 && change.Updated==1,"Un cambio solo en cabecera debe actualizarla");
Check(await Count(db,"SELECT count(*) FROM ampedia.fm_ventas_lineas WHERE documento_id='JOIN-VALIDATE-2026'")==2,
    "Se alteró el número de líneas");
var duplicate = Row(sales,"J-3",doc,"1",14.25m,2,25.15m,"ART-1");
try {
    await JoinedDocumentWriter.WriteAsync(db,"ampedia",pharmacy,sales,
        Batches(corrected, duplicate),null,CancellationToken.None);
    throw new Exception("JOIN multiplicado aceptado");
} catch (InvalidOperationException e) when (e.Message.Contains("JOIN multiplicado")) { }
// Farmatic EUR 13/03/2024: IdVenta 1327799 / IdNLinea 1 / Codigo NULL
// / Cantidad 1 / TipoLinea C. Guardar importe en el documento, sin inventar CN.
var special = Row(sales, "EUR|1327799|L|1", "EUR|1327799", "1",
    8.50m, 1m, 8.50m, null);
special["tipo_linea_origen"] = "C";
var savedSpecial = await JoinedDocumentWriter.WriteAsync(db, "ampedia", pharmacy, sales,
    Batches(special), null, CancellationToken.None);
Check(savedSpecial.Inserted == 2, "Insertar línea especial y su cabecera");
Check(await Count(db, """
SELECT count(*) FROM ampedia.fm_ventas_lineas
 WHERE documento_id='EUR|1327799' AND linea_id='1'
   AND articulo_origen_id IS NULL AND tipo_linea_origen='C'
   AND cantidad=1 AND importe_neto=8.50
""") == 1, "La línea especial debe mantener el importe y no inventar producto");
var repeatedSpecial = await JoinedDocumentWriter.WriteAsync(db, "ampedia", pharmacy, sales,
    Batches(special), null, CancellationToken.None);
Check(repeatedSpecial.Inserted == 0 && repeatedSpecial.Updated == 0,
    "Repetir línea especial no duplica importes");
var missingNormal = Row(sales, "BAD-LINE", "BAD-DOC", "1", 1m, 1m, 1m, null);
missingNormal["tipo_linea_origen"] = "A";
try
{
    await JoinedDocumentWriter.WriteAsync(db, "ampedia", pharmacy, sales,
        Batches(missingNormal), null, CancellationToken.None);
    throw new Exception("Se admitió una línea sin artículo y no especial");
}
catch (InvalidOperationException e) when (e.Message.Contains("articulo_id")) { }
Check(await Count(db, "SELECT count(*) FROM ampedia.fm_ventas_lineas WHERE documento_id='BAD-DOC'")==0,
    "Una línea inválida no puede publicarse parcialmente");

var receiptHeader = Row(receipts,"RH-1","RECEIPT-JOIN",null,8m);
var headOnly = await JoinedDocumentWriter.WriteAsync(db,"ampedia",pharmacy,receipts,
    Batches(receiptHeader),null,CancellationToken.None);
Check(headOnly.Inserted==1,"La recepción sin líneas debe preservarse");
var receiptLine = Row(receipts,"RL-1","RECEIPT-JOIN","1",8m,2,8m,"PRODUCT-9");
var withLine = await JoinedDocumentWriter.WriteAsync(db,"ampedia",pharmacy,receipts,
    Batches(receiptLine),null,CancellationToken.None);
Check(withLine.Inserted==1,"La línea tardía no debe duplicar cabecera");
Check(await Count(db,"SELECT count(*) FROM ampedia.fm_recepciones_cabeceras WHERE documento_id='RECEIPT-JOIN'")==1,
    "La cabecera de recepción se ha duplicado");
try
{
    await JoinedDocumentWriter.WriteAsync(db,"ampedia",pharmacy,sales,
        Batches(),null,CancellationToken.None,true);
    throw new Exception("Se permitió confirmar una carga completa vacía");
}
catch (InvalidOperationException e) when (e.Message.Contains("completa de documentos vacía")) { }
// Regression de cargas masivas: >1000 filas activa el índice temporal y
// mantiene atomicidad e idempotencia después del análisis de staging.
var sourceRows = Enumerable.Range(1, 1100)
    .Select(i => Row(sales, $"STRESS-L-{i}", $"STRESS-D-{i}", "1",
        12.25m, 1m, 12.25m, "ART-1")).ToArray();
var phases = new List<string>();
var historical = await JoinedDocumentWriter.WriteAsync(db, "ampedia", pharmacy, sales,
    Batches(sourceRows), p => phases.Add(p.Phase), CancellationToken.None, true);
Check(historical.Rows == 1100 && historical.Inserted == 2200,
    "La carga histórica con índice staging debe insertar 1100 cabeceras y líneas");
Check(phases.Contains("Indexando staging para validación") &&
      phases.Contains("Validando consistencia de cabeceras") &&
      phases.Contains("Insertando o actualizando líneas"),
    "Debe informar de indexación, validación y publicación en PostgreSQL");
var retry = await JoinedDocumentWriter.WriteAsync(db, "ampedia", pharmacy, sales,
    Batches(sourceRows), null, CancellationToken.None, true);
Check(retry.Inserted == 0 && retry.Updated == 0,
    "Una reconciliación masiva repetida debe ser idempotente");

Console.WriteLine("PostgreSQL JOIN writer: atomicidad, idempotencia, cambios y recuperación OK");


// Regresión de supervisión: la API ya crea ejecucion_id, sistema_origen y
// modificadas. Nunca volver a intentar INSERT (id) contra ese contrato.
var monitorPharmacy = new Pharmacy { Code = "TEST-MONITOR", SystemType = "farmatic" };
var monitorEntity = sales;
var monitorJob = new SyncJob {
    PharmacyId = monitorPharmacy.Id, EntityId = monitorEntity.Id, Enabled = true,
    EveryMinutes = 60
};
var monitorRun = new SyncRun {
    JobId = monitorJob.Id, PharmacyId = monitorPharmacy.Id, EntityId = monitorEntity.Id,
    PharmacyCode = monitorPharmacy.Code, EntityName = monitorEntity.Name,
    Status = "completado", StartedUtc = DateTimeOffset.UtcNow.AddMinutes(-2),
    FinishedUtc = DateTimeOffset.UtcNow.AddMinutes(-1),
    Rows = 8, Inserted = 6, Updated = 2
};
var monitorConfig = new AppConfig {
    MonitorInstanceId = Guid.NewGuid(),
    Pharmacies = [monitorPharmacy], Entities = [monitorEntity],
    Jobs = [monitorJob], Runs = [monitorRun]
};
await PostgresDestination.PublishMonitoringToConnectionAsync(db,
    new Destination { Schema = "ampedia" }, monitorConfig, [], CancellationToken.None);
Check(await Count(db,
    $"SELECT count(*) FROM ampedia.fm_sync_ejecuciones WHERE ejecucion_id='{monitorRun.Id}' " +
    "AND sistema_origen='farmatic' AND modificadas=2") == 1,
    "El historial debe escribir usando la clave y columnas del modelo documental");
Check(await Count(db,
    $"SELECT count(*) FROM ampedia.fm_sync_monitor WHERE instancia_id='{monitorConfig.MonitorInstanceId}' " +
    $"AND trabajo_id='{monitorJob.Id}'") == 1, "Debe guardar también el pulso del trabajo");
await PostgresDestination.PublishMonitoringToConnectionAsync(db,
    new Destination { Schema = "ampedia" }, monitorConfig, [], CancellationToken.None);
Check(await Count(db,
    $"SELECT count(*) FROM ampedia.fm_sync_ejecuciones WHERE ejecucion_id='{monitorRun.Id}'") == 1,
    "La retransmisión del historial no debe duplicar ejecuciones");
// Un cliente antiguo puede tener aún el historial con PK (id). Su migración
// debe conservar las filas y adaptar la misma tabla sin renombrarla ni borrarla.
var legacySchema = "fm_mon_" + Guid.NewGuid().ToString("N")[..12];
await using (var cmd = new NpgsqlCommand($"""
    CREATE SCHEMA {legacySchema};
    CREATE TABLE {legacySchema}.fm_sync_ejecuciones (
      id uuid PRIMARY KEY, trabajo_id uuid NOT NULL,
      farmacia_codigo text NOT NULL, flujo text NOT NULL,
      estado text NOT NULL, iniciada_en timestamptz NOT NULL,
      finalizada_en timestamptz, leidas bigint NOT NULL DEFAULT 0,
      insertadas bigint NOT NULL DEFAULT 0, rechazadas bigint NOT NULL DEFAULT 0,
      error_resumen text
    );
    INSERT INTO {legacySchema}.fm_sync_ejecuciones
      (id,trabajo_id,farmacia_codigo,flujo,estado,iniciada_en)
    VALUES ('{Guid.NewGuid()}','{monitorJob.Id}','TEST-MONITOR',
      'ventas_completas','completado',now() - interval '1 day');
    """, db))
    await cmd.ExecuteNonQueryAsync();
try
{
    await PostgresDestination.PublishMonitoringToConnectionAsync(db,
        new Destination { Schema = legacySchema }, monitorConfig, [], CancellationToken.None);
    Check(await Count(db, $"SELECT count(*) FROM {legacySchema}.fm_sync_ejecuciones") == 2,
        "La migración del historial anterior debe preservar filas y añadir la nueva");
    Check(await Count(db, $"""
        SELECT count(*) FROM {legacySchema}.fm_sync_ejecuciones
         WHERE ejecucion_id='{monitorRun.Id}' AND sistema_origen='farmatic'
           AND modificadas=2
        """) == 1, "Historial heredado migrado y enriquecido correctamente");
}
finally
{
    await using var drop = new NpgsqlCommand($"DROP SCHEMA {legacySchema} CASCADE", db);
    await drop.ExecuteNonQueryAsync();
}
Console.WriteLine("PostgreSQL supervisión: esquema canónico, idempotencia y migración legacy OK");
