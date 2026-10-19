using FarmetricaSync.Core;

static void Assert(string? cn, string country, string segment, string sub, string? normalized)
{
    var result = ProductClassification.InferFromCn(cn, country);
    if (result.Segment != segment || result.Subcategory != sub || result.NormalizedCn != normalized)
        throw new Exception($"Clasificación incorrecta {cn}/{country}: {result}");
    if (result.Origin == "regla_cn" && result.Confidence >= 0.9m)
        throw new Exception("La regla de prefijo no puede ser de confianza alta");
}
Assert("123456", "ES", "parafarmacia", "parafarmacia", "123456");
Assert("412345.8", "ES", "otros", "efectos_accesorios", "412345");
Assert("5123459", "ES", "otros", "dietoterapico", "512345");
Assert("912345", "ES", "medicamento", "medicamento", "912345");
Assert("012345", "ES", "sin_clasificar", "sin_clasificar", "012345");
Assert("912345", "FR", "sin_clasificar", "sin_clasificar", null);
Assert("0841234567890", "ES", "sin_clasificar", "sin_clasificar", null);
Assert(null, "ES", "sin_clasificar", "sin_clasificar", null);
Console.WriteLine("Clasificación de productos: OK");
