namespace FarmetricaSync.Core;

// Contrato común de una fila devuelta por el JOIN cabecera + línea.
// Los identificadores nunca se derivan del número de fila ni de un CN.
public sealed record JoinedDocumentRow(
    string DocumentId, string? LineId, DateTime Timestamp,
    string? CustomerId = null, string? SupplierId = null, decimal? DocumentTotal = null,
    decimal? DocumentDiscount = null, decimal? DocumentTax = null,
    string Status = "desconocido", string? ProductSourceId = null,
    decimal? Quantity = null, decimal? UnitPrice = null, decimal? LineDiscount = null,
    decimal? NetAmount = null, decimal? LineTax = null, decimal? HistoricalCost = null,
    DateTime? ModifiedAt = null);

public sealed record NormalizedDocumentHeader(
    string PharmacyCode, string SourceSystem, string SourceDocumentId,
    DateTime Timestamp, string? CustomerId, string? SupplierId,
    decimal? Total, decimal? Discount, decimal? Tax, string Status,
    DateTime? ModifiedAt);
public sealed record NormalizedDocumentLine(
    string PharmacyCode, string SourceSystem, string SourceDocumentId,
    string SourceLineId, string ProductSourceId, decimal Quantity,
    decimal? UnitPrice, decimal? Discount, decimal? NetAmount,
    decimal? Tax, decimal? HistoricalCost);
public sealed record DocumentIssue(string DocumentId, string Reason);
public sealed record NormalizedDocumentBatch(
    IReadOnlyList<NormalizedDocumentHeader> Headers,
    IReadOnlyList<NormalizedDocumentLine> Lines,
    IReadOnlyList<DocumentIssue> Issues);

public static class JoinedDocumentNormalizer
{
    public static NormalizedDocumentBatch Normalize(
        IEnumerable<JoinedDocumentRow> sourceRows, string configuredPharmacyCode, string sourceSystem)
    {
        if (string.IsNullOrWhiteSpace(configuredPharmacyCode) || string.IsNullOrWhiteSpace(sourceSystem))
            throw new ArgumentException("Farmacia y ERP deben venir de la configuración del sincronizador.");

        var headers = new Dictionary<string, NormalizedDocumentHeader>(StringComparer.Ordinal);
        var lines = new List<NormalizedDocumentLine>();
        var issues = new List<DocumentIssue>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var withLines = new HashSet<string>(StringComparer.Ordinal);
        foreach (var row in sourceRows)
        {
            if (row is null || string.IsNullOrWhiteSpace(row.DocumentId))
                throw new InvalidOperationException("El JOIN contiene una cabecera sin identificador estable.");
            var documentId = row.DocumentId.Trim();
            var header = new NormalizedDocumentHeader(
                configuredPharmacyCode.Trim(), sourceSystem.Trim().ToLowerInvariant(),
                documentId, row.Timestamp, row.CustomerId, row.SupplierId,
                row.DocumentTotal, row.DocumentDiscount, row.DocumentTax,
                string.IsNullOrWhiteSpace(row.Status) ? "desconocido" : row.Status.Trim().ToLowerInvariant(),
                row.ModifiedAt);
            if (headers.TryGetValue(documentId, out var known))
            {
                if (known != header)
                    throw new InvalidOperationException($"Cabecera inconsistente en documento {documentId}: revisar cardinalidad del JOIN.");
            }
            else headers.Add(documentId, header);

            if (string.IsNullOrWhiteSpace(row.LineId))
            {
                // LEFT JOIN: un documento puede llegar antes que sus líneas o carecer
                // de detalle accesible. Se retiene la cabecera sin inventar artículos.
                if (!string.IsNullOrWhiteSpace(row.ProductSourceId) || row.Quantity.HasValue)
                    throw new InvalidOperationException($"Documento {documentId} tiene datos de línea sin clave de línea.");
                continue;
            }
            var lineId = row.LineId.Trim();
            // \u001F separa las claves; IDs con ese carácter no son admitidos.
            if (documentId.Contains('\u001F') || lineId.Contains('\u001F'))
                throw new InvalidOperationException("Carácter no permitido en los identificadores de origen.");
            var composite = documentId + "\u001F" + lineId;
            if (!seen.Add(composite))
                throw new InvalidOperationException($"JOIN multiplicado: línea {lineId} repetida en documento {documentId}.");
            if (string.IsNullOrWhiteSpace(row.ProductSourceId) || !row.Quantity.HasValue)
            {
                issues.Add(new DocumentIssue(documentId, $"Línea {lineId}: producto o cantidad ausentes"));
                continue;
            }
            withLines.Add(documentId);
            // No se invierten signos ni se vuelven a aplicar descuentos: se
            // conservan tal cual llegaron desde el ERP para conciliación.
            lines.Add(new NormalizedDocumentLine(configuredPharmacyCode.Trim(),
                sourceSystem.Trim().ToLowerInvariant(), documentId, lineId,
                row.ProductSourceId.Trim(), row.Quantity.Value,
                row.UnitPrice, row.LineDiscount, row.NetAmount, row.LineTax,
                row.HistoricalCost));
        }
        foreach (var key in headers.Keys)
            if (!withLines.Contains(key))
                issues.Add(new DocumentIssue(key, "cabecera_sin_lineas_recuperable"));
        return new NormalizedDocumentBatch(headers.Values.ToList(), lines, issues);
    }
}
