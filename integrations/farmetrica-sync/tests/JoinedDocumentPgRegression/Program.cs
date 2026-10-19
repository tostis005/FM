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
