using System.ComponentModel.DataAnnotations;

namespace FarmetricaSync.Core;

public sealed class AppConfig
{
    // Identificador persistente de esta instalación; no se comparte entre equipos.
    public Guid MonitorInstanceId { get; set; } = Guid.Empty;
    public string? AdminSalt { get; set; }
    public string? AdminHash { get; set; }
    public Destination Destination { get; set; } = new();
    public MailSettings Mail { get; set; } = new();
    public List<Pharmacy> Pharmacies { get; set; } = [];
    public List<EntityDefinition> Entities { get; set; } = CanonicalEntities.Create();
    public List<SyncJob> Jobs { get; set; } = [];
    public List<SyncState> States { get; set; } = [];
    public List<SyncRun> Runs { get; set; } = [];
}

public sealed class Destination
{
    public string Host { get; set; } = "";
    public int Port { get; set; } = 5432;
    public string Database { get; set; } = "";
    public string Username { get; set; } = "";
    public string PasswordProtected { get; set; } = "";
    public string Schema { get; set; } = "farmetrica";
    public string SslMode { get; set; } = "VerifyFull";
    public bool SshEnabled { get; set; }
    public string SshHost { get; set; } = "";
    public int SshPort { get; set; } = 22;
    public string SshUsername { get; set; } = "";
    public string SshAuthMode { get; set; } = "password"; // password | privateKey
    public string SshPasswordProtected { get; set; } = "";
    public string SshPrivateKeyPath { get; set; } = "";
    public string SshKeyPassphraseProtected { get; set; } = "";
    // e.g. SHA256:abc... obtained securely from the server administrator.
    public string SshHostKeySha256 { get; set; } = "";
}

public sealed class MailSettings
{
    public bool Enabled { get; set; }
    public string Host { get; set; } = "";
    public int Port { get; set; } = 587;
    public string Username { get; set; } = "";
    public string PasswordProtected { get; set; } = "";
    public string From { get; set; } = "";
    public string To { get; set; } = "";
    public bool NotifyRecovery { get; set; } = false;
}

public sealed class Pharmacy
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public string SystemType { get; set; } = "farmatic";
    public string CountryCode { get; set; } = "ES"; // ISO 3166-1 alfa-2; reglas CN solo ES
    public string ConnectionMode { get; set; } = "linked"; // linked | direct
    public string Server { get; set; } = "."; // SQL Server accesible desde el servicio
    public string Database { get; set; } = ""; // BD remota si linked
    public string LinkedServer { get; set; } = "";
    public string AuthMode { get; set; } = "integrated"; // integrated | sql
    public string Username { get; set; } = "";
    public string PasswordProtected { get; set; } = "";
    public string TimeZoneId { get; set; } = "Romance Standard Time"; // zona del reloj de las fechas en SQL Server
    public bool TrustServerCertificate { get; set; } = false;
    public bool Enabled { get; set; } = true;
}

public sealed class EntityColumn
{
    public string Name { get; set; } = "";
    public string Type { get; set; } = "text"; // text | numeric | timestamp | bool | integer
}

public sealed class EntityDefinition
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public List<EntityColumn> Columns { get; set; } = [];
}

public sealed class SyncJob
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid PharmacyId { get; set; }
    public Guid EntityId { get; set; }
    public string Sql { get; set; } = "";
    // Consulta independiente para carga completa manual, sin filtro incremental.
    public string FullSql { get; set; } = "";
    public string Mode { get; set; } = "incremental"; // incremental | snapshot
    public int EveryMinutes { get; set; } = 60;
    // Heredado para compatibilidad con JSON/API antiguos. El planificador ya
    // NO reintenta con una cadencia distinta tras fallos de conexión.
    public int RetryMinutes { get; set; } = 5;
    // Solo se usa cuando EveryMinutes == 1440. Hora en zona de la farmacia.
    // NULL mantiene el intervalo móvil antiguo en configuraciones existentes.
    public string? DailyAtLocal { get; set; }
    public int BatchSize { get; set; } = 5000; // filas por lote; memoria acotada
    public DateTime InitialFromUtc { get; set; } = new(2000, 1, 1, 0, 0, 0, DateTimeKind.Utc);
    public bool Enabled { get; set; } = false;
    // Tiempo durante el que puede retrasarse un alta respecto de su fecha de origen.
    // Debe acordarse con el proveedor del software. La extracción utiliza >= @desde y < @hasta.
    public int ReplayMinutes { get; set; } = 180;
    // Evita procesar los registros más recientes todavía no estabilizados.
    public int SafetyDelayMinutes { get; set; } = 5;
    // Opcional: sobreescribe el destino SMTP común para este trabajo.
    public string AlertRecipients { get; set; } = "";
}

public sealed class SyncState
{
    public Guid JobId { get; set; }
    public DateTimeOffset? LastAttemptUtc { get; set; }
    // Persistido también tras ERROR: evitar un nuevo intento inmediatamente
    // después de una consulta muy larga o tras reiniciar el servicio.
    public DateTimeOffset? LastCompletedUtc { get; set; }
    public DateTimeOffset? LastSuccessUtc { get; set; }
    public DateTimeOffset? WatermarkUtc { get; set; }
    public DateTimeOffset? LastFullSuccessUtc { get; set; }
    public DateTimeOffset? LastAlertUtc { get; set; }
    public long LastRows { get; set; }
    public string LastStatus { get; set; } = "pending";
    public string LastError { get; set; } = "";
    public long LastInserted { get; set; }
    public long LastUpdated { get; set; }
    public long LastDeleted { get; set; }
}

public sealed record SyncRun
{
    // Las ejecuciones activas usan este mismo contrato, pero no se persisten hasta finalizar.

    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid JobId { get; set; }
    public Guid PharmacyId { get; set; }
    public Guid EntityId { get; set; }
    public DateTimeOffset StartedUtc { get; set; }
    public DateTimeOffset? FinishedUtc { get; set; }
    public string Status { get; set; } = "";
    public string Mode { get; set; } = "incremental";
    public long Rows { get; set; }
    public long Inserted { get; set; }
    public long Updated { get; set; }
    public long Deleted { get; set; }
    public long Duplicates { get; set; }
    public DateTimeOffset? FromUtc { get; set; }
    public DateTimeOffset? UntilUtc { get; set; }
    public string PharmacyCode { get; set; } = "";
    public string EntityName { get; set; } = "";
    public string Error { get; set; } = "";
    public string Phase { get; set; } = "";
    public long Batches { get; set; }
    public DateTimeOffset? LastProgressUtc { get; set; }
    // Mientras se ejecuta, las filas son provisionales hasta el commit PostgreSQL.
    public bool Provisional { get; set; }
}

public sealed record SyncWriteProgress(string Phase, long Rows, long Batches,
    long Inserted, long Updated, long Deleted, long Duplicates);

public static class CanonicalEntities
{
    public static List<EntityDefinition> Create() =>
    [
        // Dos flujos documentales futuros: una única consulta JOIN por trabajo.
        // Las plantillas SQL concretas quedan deshabilitadas hasta validar
        // columnas reales de cabecera y detalle en cada ERP.
        E("ventas_completas", "Tickets y líneas normalizados desde una consulta JOIN",
            ("documento_id", "text"), ("linea_id", "text"), ("fecha", "timestamp"),
            ("numero_documento", "text"), ("tercero_id", "text"), ("empleado_id", "text"),
            ("estado", "text"), ("total_documento", "numeric"),
            ("descuento_global", "numeric"), ("descuento_global_tipo", "text"),
            ("impuestos_documento", "numeric"), ("modificado_origen", "timestamp"),
            ("articulo_id", "text"), ("tipo_linea_origen", "text"), ("unidades", "numeric"), ("precio_unitario", "numeric"),
            ("descuento_linea", "numeric"), ("descuento_linea_tipo", "text"),
            ("importe_neto", "numeric"), ("impuesto_linea", "numeric"),
            ("coste_historico", "numeric"), ("bonificacion_unidades", "numeric"),
            ("numero_pedido", "text"), ("eliminado_logicamente", "bool"),
            ("linea_eliminada", "bool")),
        E("recepciones_completas", "Recepciones y líneas normalizadas desde una consulta JOIN",
            ("documento_id", "text"), ("linea_id", "text"), ("fecha", "timestamp"),
            ("numero_documento", "text"), ("tercero_id", "text"), ("empleado_id", "text"),
            ("estado", "text"), ("total_documento", "numeric"),
            ("descuento_global", "numeric"), ("descuento_global_tipo", "text"),
            ("impuestos_documento", "numeric"), ("modificado_origen", "timestamp"),
            ("articulo_id", "text"), ("unidades", "numeric"), ("precio_unitario", "numeric"),
            ("descuento_linea", "numeric"), ("descuento_linea_tipo", "text"),
            ("importe_neto", "numeric"), ("impuesto_linea", "numeric"),
            ("coste_historico", "numeric"), ("bonificacion_unidades", "numeric"),
            ("numero_pedido", "text"), ("eliminado_logicamente", "bool"),
            ("linea_eliminada", "bool")),
        E("ventas", "Líneas de venta", ("fecha", "timestamp"), ("articulo_id", "text"), ("unidades", "numeric"), ("precio_unitario", "numeric"), ("importe", "numeric"), ("numero_ticket", "text"), ("descuento_linea", "numeric"), ("descuento_operacion", "numeric")),
        // vRecep ofrece cabeceras de recepciones, NO líneas de artículos ni importes de compra.
        // Los campos de línea se conservan vacíos hasta incorporar una tabla detalle real.
        E("compras", "Cabeceras de recepción Farmatic (pendientes líneas de compra)", ("fecha", "timestamp"), ("articulo_id", "text"), ("proveedor_id", "text"), ("unidades", "numeric"), ("coste_unitario", "numeric"), ("importe", "numeric"),
            ("hora_recepcion", "text"), ("fecha_hora_recepcion", "timestamp"), ("numero_pedido", "text"), ("albaran_id", "text"), ("condicion_id", "text"), ("vendedor_id", "text"), ("recepcion_actualizada", "bool"), ("recepcion_demorada", "bool"), ("proveedor_nombre", "text"), ("descripcion", "text")),
        E("articulos", "Catálogo y existencias actuales por artículo", ("nombre", "text"), ("codigo_nacional", "text"), ("ean", "text"), ("familia", "text"), ("laboratorio", "text"), ("pvp", "numeric"),
            ("presentacion", "text"), ("situacion", "text"), ("puc", "numeric"), ("pmc", "numeric"), ("proveedor_habitual_id", "text"), ("fecha_ultima_entrada", "timestamp"), ("fecha_ultima_salida", "timestamp"),
            ("segmento_comercial", "text"), ("subcategoria", "text"), ("clasificacion_origen", "text"), ("clasificacion_confianza", "numeric"), ("cn_normalizado", "text"),
            ("stock_actual", "numeric"), ("stock_minimo", "numeric"), ("stock_maximo", "numeric"), ("lote_optimo", "numeric")),
        E("familias", "Familias y superfamilias de artículos Farmatic", ("nombre", "text"),
            ("superfamilia_id", "text"), ("superfamilia_nombre", "text"),
            ("coeficiente_1", "numeric"), ("coeficiente_2", "numeric"),
            ("factor_descuento_credito", "numeric"), ("desviacion", "numeric"),
            ("grupo_iva_id", "text"), ("deducible_hacienda", "bool"),
            ("grupo_formulacion", "text"), ("empresa", "text"),
            ("informacion_especial", "text")),
        // IDVENDEDOR es local a cada Farmatic; nombres repetidos son válidos.
        // El enlace se realiza por farmacia_codigo + origen_id, nunca por NOMBRE.
        E("vendedores", "Catálogo de vendedores Farmatic",
            ("nombre", "text"), ("tipo", "text"), ("color_ventas", "integer")),
        E("proveedores", "Maestro de proveedores", ("nombre", "text"), ("nif", "text"), ("telefono", "text"), ("email", "text"),
            ("direccion", "text"), ("codigo_postal", "text"), ("poblacion", "text"), ("provincia", "text"), ("web", "text"), ("descuento", "numeric"))
    ];

    private static EntityDefinition E(string name, string description, params (string, string)[] columns) => new()
    {
        Name = name,
        Description = description,
        Columns = [new() { Name = "origen_id", Type = "text" }, .. columns.Select(c => new EntityColumn { Name = c.Item1, Type = c.Item2 })]
    };
}

public sealed record DestinationRequest(string Host, int Port, string Database, string Username, string? Password, string Schema, string SslMode,
    bool SshEnabled = false, string SshHost = "", int SshPort = 22, string SshUsername = "",
    string SshAuthMode = "password", string? SshPassword = null, string SshPrivateKeyPath = "",
    string? SshKeyPassphrase = null, string SshHostKeySha256 = "");
public sealed record MailRequest(bool Enabled, string Host, int Port, string Username, string? Password, string From, string To, bool NotifyRecovery = false);
public sealed record PharmacyRequest(string Code, string Name, string SystemType, string ConnectionMode, string Server, string Database, string LinkedServer, string AuthMode, string Username, string? Password, string TimeZoneId, bool TrustServerCertificate, bool Enabled, string CountryCode = "ES");
public sealed record JobRequest(Guid PharmacyId, Guid EntityId, string Sql, string FullSql, string Mode, int EveryMinutes, DateTime InitialFromUtc, bool Enabled, int BatchSize = 5000, int ReplayMinutes = 180, int SafetyDelayMinutes = 5, string AlertRecipients = "", int RetryMinutes = 5, string? DailyAtLocal = null);
public sealed record PasswordRequest(string Password);
