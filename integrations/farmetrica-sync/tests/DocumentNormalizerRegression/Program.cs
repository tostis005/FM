using FarmetricaSync.Core;
static void Check(bool value, string error) { if (!value) throw new Exception(error); }

var sale = JoinedDocumentNormalizer.Normalize([
    new("T-1", "1", new DateTime(2026, 10, 19, 10, 0, 0), DocumentTotal: 20m,
        ProductSourceId: "ART-1", Quantity: 2m, NetAmount: 25m, DocumentDiscount: 5m),
    new("T-1", "2", new DateTime(2026, 10, 19, 10, 0, 0), DocumentTotal: 20m,
        ProductSourceId: "ART-2", Quantity: -1m, NetAmount: -5m, DocumentDiscount: 5m),
], "ABA", "farmatic");
Check(sale.Headers.Count == 1 && sale.Lines.Count == 2, "No se normaliza una cabecera con dos líneas.");
Check(sale.Headers[0].Discount == 5m, "El descuento global se ha multiplicado por líneas.");
Check(sale.Lines[1].Quantity == -1m && sale.Lines[1].NetAmount == -5m, "Se perdieron signos de devolución.");
Check(sale.Lines.All(l => l.PharmacyCode == "ABA"), "Farmacia debe venir de configuración.");
var pending = JoinedDocumentNormalizer.Normalize([
    new("R-7", null, new DateTime(2026, 10, 19), SupplierId: "P1")
], "EUR", "farmatic");
Check(pending.Headers.Count == 1 && pending.Lines.Count == 0 && pending.Issues.Count == 1,
    "El LEFT JOIN debe admitir cabeceras pendientes.");
try {
    JoinedDocumentNormalizer.Normalize([
        new("T", "L1", new DateTime(2026,10,19), ProductSourceId:"A", Quantity:1),
        new("T", "L1", new DateTime(2026,10,19), ProductSourceId:"A", Quantity:1)
    ], "ABA", "farmatic");
    throw new Exception("Se aceptó multiplicación de JOIN.");
} catch (InvalidOperationException) { }
try {
    JoinedDocumentNormalizer.Normalize([
        new("T", "L1", new DateTime(2026,10,19), DocumentTotal:12, ProductSourceId:"A", Quantity:1),
        new("T", "L2", new DateTime(2026,10,19), DocumentTotal:11, ProductSourceId:"B", Quantity:1)
    ], "ABA", "farmatic");
    throw new Exception("Se aceptó cabecera inconsistente.");
} catch (InvalidOperationException) { }
Console.WriteLine("Contrato documental y JOIN: OK");
