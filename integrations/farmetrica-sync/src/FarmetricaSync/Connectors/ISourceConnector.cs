using FarmetricaSync.Core;

namespace FarmetricaSync.Connectors;

public interface ISourceConnector
{
    string SystemType { get; }

    // A bounded async stream: source rows are never materialized in one large list.
    IAsyncEnumerable<IReadOnlyList<Dictionary<string, object?>>> ReadBatchesAsync(
        Pharmacy pharmacy, SyncJob job, EntityDefinition entity,
        DateTime sinceUtc, DateTime untilUtc, int batchSize,
        Action<long>? onSourceRows, CancellationToken ct);

    Task TestAsync(Pharmacy pharmacy, CancellationToken ct);
    Task<IReadOnlyList<Dictionary<string, object?>>> PreviewAsync(
        Pharmacy pharmacy, SyncJob job, EntityDefinition entity,
        DateTime sinceUtc, DateTime untilUtc, int limit, CancellationToken ct);
}

public sealed class ConnectorCatalog(IEnumerable<ISourceConnector> connectors)
{
    public ISourceConnector For(string systemType) => connectors.SingleOrDefault(c => c.SystemType == systemType)
        ?? throw new NotSupportedException($"Conector no implementado: {systemType}");
}
