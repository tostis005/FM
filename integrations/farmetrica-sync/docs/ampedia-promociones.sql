-- Ejecutar en la MISMA base PostgreSQL en la que el sincronizador carga ampedia.ventas.
-- Idempotente y no destructivo: no modifica ventas, ni borra promociones anteriores.
-- Prefijo fm_ para no sobrescribir posibles tablas de importaciones existentes.
begin;
create extension if not exists pgcrypto;
create schema if not exists ampedia;

create table if not exists ampedia.fm_promociones (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(trim(nombre)) > 0),
  descripcion text not null default '',
  fecha_inicio date not null,
  fecha_fin date not null,
  estado text not null default 'activa' check (estado in ('borrador','activa','finalizada','cancelada')),
  fuente_importacion text,
  id_externo text,
  datos_originales jsonb,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  check (fecha_fin >= fecha_inicio),
  unique (fuente_importacion,id_externo)
);
create table if not exists ampedia.fm_promocion_articulos (
  promocion_id uuid not null references ampedia.fm_promociones(id) on delete cascade,
  articulo_id text not null,
  tipo_identificador text not null default 'source_article_id',
  primary key (promocion_id,articulo_id)
);
-- articulo_id corresponde al contrato canónico de las ventas sincronizadas;
-- para otros identificadores debe existir un mapeo explícito, no se supone equivalencia CN/EAN.
create table if not exists ampedia.fm_promocion_farmacias (
  promocion_id uuid not null references ampedia.fm_promociones(id) on delete cascade,
  farmacia_codigo text not null,
  objetivo_unidades numeric(18,4) not null default 0 check (objetivo_unidades >= 0),
  primary key (promocion_id,farmacia_codigo)
);
create table if not exists ampedia.fm_promocion_importaciones (
  id uuid primary key default gen_random_uuid(),
  fuente text not null,
  referencia text,
  registros integer not null default 0,
  importado_en timestamptz not null default now(),
  unique (fuente,referencia)
);
create table if not exists ampedia.fm_promocion_importacion_filas (
  importacion_id uuid not null references ampedia.fm_promocion_importaciones(id) on delete restrict,
  posicion integer not null check (posicion >= 0),
  contenido jsonb not null,
  primary key (importacion_id,posicion)
);
create index if not exists idx_fm_promociones_fechas on ampedia.fm_promociones(fecha_inicio,fecha_fin);
create index if not exists idx_fm_promocion_farmacias_codigo on ampedia.fm_promocion_farmacias(farmacia_codigo,promocion_id);
create index if not exists idx_fm_promocion_articulos_codigo on ampedia.fm_promocion_articulos(articulo_id,promocion_id);
commit;
-- Opcional, fuera de transacción y en ventana de bajo tráfico:
-- create index concurrently if not exists idx_ampedia_ventas_promociones
--   on ampedia.ventas(farmacia_codigo, articulo_id, fecha);
-- ANTES de importar históricos, exportar y cotejar las tablas de origen; nunca sobrescribir sin copia.
