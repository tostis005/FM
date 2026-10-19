using System.Text.RegularExpressions;

namespace FarmetricaSync.Core;

// Inferencia conservadora: únicamente sobre el campo CN, nunca sobre EAN ni ID local.
// Las correcciones de fuentes oficiales/manuales se almacenarán por separado.
public sealed record ProductCategory(string Segment, string Subcategory, string Origin,
    decimal Confidence, string? NormalizedCn);

public static class ProductClassification
{
    private static readonly Regex SpanishCn = new(
        @"^([0-9]{6})(?:\\.?[0-9])?$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    public static ProductCategory InferFromCn(string? originalCn, string? countryCode)
    {
        var unknown = new ProductCategory("sin_clasificar", "sin_clasificar", "sin_clasificar", 0m, null);
        if (!string.Equals(countryCode?.Trim(), "ES", StringComparison.OrdinalIgnoreCase))
            return unknown;
        var match = SpanishCn.Match(originalCn?.Trim() ?? "");
        if (!match.Success) return unknown;
        var normalized = match.Groups[1].Value;
        // Coincidencia de formato, NO validación contra el catálogo oficial ni
        // demostración de que el producto sea medicamento.
        return normalized[0] switch
        {
            '1' or '2' or '3' => new("parafarmacia", "parafarmacia", "regla_cn", 0.55m, normalized),
            '4' => new("otros", "efectos_accesorios", "regla_cn", 0.55m, normalized),
            '5' => new("otros", "dietoterapico", "regla_cn", 0.55m, normalized),
            '6' or '7' or '8' or '9' => new("medicamento", "medicamento", "regla_cn", 0.55m, normalized),
            _ => unknown with { NormalizedCn = normalized }
        };
    }
}
