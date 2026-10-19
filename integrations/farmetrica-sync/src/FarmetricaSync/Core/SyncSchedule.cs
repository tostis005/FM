namespace FarmetricaSync.Core;

/// <summary>
/// Una incidencia de conexión no tiene cadencia de reintento propia:
/// solo se vuelve a consultar en el siguiente horario elegido.
/// No avanza cursores ni altera las fechas de extracción de Farmatic.
/// </summary>
public static class SyncSchedule
{
    public static DateTimeOffset NextDueUtc(
        SyncJob job, SyncState? state, Pharmacy pharmacy, DateTimeOffset now)
    {
        if (job.EveryMinutes == 1440 && !string.IsNullOrWhiteSpace(job.DailyAtLocal))
        {
            if (!TimeOnly.TryParseExact(job.DailyAtLocal, "HH:mm",
                    System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.None, out var hour))
                throw new ArgumentException("La hora diaria debe tener formato HH:mm.");

            // TimeZoneId es la zona HORARIA de la farmacia, no la del equipo central.
            var zone = TimeZoneInfo.FindSystemTimeZoneById(pharmacy.TimeZoneId);
            var localToday = TimeZoneInfo.ConvertTime(now, zone).Date;
            var slotToday = ToUtcSlot(localToday, hour, zone);

            // Un intento confirmado para ese horario evita ejecutarlo otra vez,
            // aunque haya dado error o el servicio Windows se haya reiniciado.
            // Las ejecuciones manuales posteriores al horario también lo consumen.
            // También cubrir cargas iniciadas ANTES de la hora fija que acaban
            // DESPUÉS de ella: no reintentar inmediatamente tras una carga larga.
            if ((state?.LastAttemptUtc is { } attempted && attempted >= slotToday) ||
                (state?.LastCompletedUtc is { } finished && finished >= slotToday))
                return ToUtcSlot(localToday.AddDays(1), hour, zone);
            return slotToday;
        }

        // El intervalo se cuenta desde que TERMINA la ejecución, incluso en
        // errores de VPN. Para instalaciones antiguas sin LastCompletedUtc usar
        // la fecha persistida del intento como alternativa conservadora.
        var last = state?.LastCompletedUtc ??
            (state?.LastStatus == "ok" ? state.LastSuccessUtc : null) ??
            state?.LastAttemptUtc;
        return last?.AddMinutes(job.EveryMinutes) ?? now;
    }

    public static bool IsDue(SyncJob job, SyncState? state, Pharmacy pharmacy, DateTimeOffset now) =>
        NextDueUtc(job, state, pharmacy, now) <= now;

    private static DateTimeOffset ToUtcSlot(DateTime day, TimeOnly hour, TimeZoneInfo zone)
    {
        var local = DateTime.SpecifyKind(day.Date.Add(hour.ToTimeSpan()), DateTimeKind.Unspecified);
        // En el salto de hora de primavera una hora local podría no existir.
        // Ejecutarla en el primer minuto local válido de ese día.
        while (zone.IsInvalidTime(local)) local = local.AddMinutes(1);
        // En otoño, elegir la primera ocurrencia: el estado persistido evita
        // que se repita en la segunda.
        var offset = zone.IsAmbiguousTime(local)
            ? zone.GetAmbiguousTimeOffsets(local).Max()
            : zone.GetUtcOffset(local);
        return new DateTimeOffset(local, offset).ToUniversalTime();
    }
}
