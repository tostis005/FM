namespace FarmetricaSync.Core;

public sealed record PharmacyProbeRequest(PharmacyRequest Pharmacy, Guid? ExistingPharmacyId);
public sealed record DestinationProbeRequest(DestinationRequest Destination);
public sealed record JobPreviewRequest(Guid PharmacyId, Guid EntityId, string Sql,
    string Mode, DateTime FromUtc, DateTime UntilUtc);
