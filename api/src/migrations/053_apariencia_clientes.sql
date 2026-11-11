-- 053 · Marca blanca por cliente. Aditiva y aislada por cliente.
CREATE TABLE IF NOT EXISTS farmetrica.cliente_apariencia (
  cliente_slug text PRIMARY KEY REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
  nombre_marca text NOT NULL DEFAULT '',
  logo_url text NOT NULL DEFAULT '',
  color_primario text NOT NULL DEFAULT '#079B6D',
  color_secundario text NOT NULL DEFAULT '#145C49',
  estilo_menu text NOT NULL DEFAULT 'claro'
    CHECK (estilo_menu IN ('claro','oscuro')),
  actualizado_por text,
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cliente_apariencia_color_primario_ck CHECK(color_primario ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT cliente_apariencia_color_secundario_ck CHECK(color_secundario ~ '^#[0-9A-Fa-f]{6}$')
);

-- Identidad inicial del cliente existente. No pisa ajustes manuales posteriores.
-- Logo horizontal oficial de la cabecera pública de farmaciaabadia.com.
-- El superadministrador puede cambiarlo después desde el editor visual.
INSERT INTO farmetrica.cliente_apariencia
 (cliente_slug,nombre_marca,logo_url,color_primario,color_secundario,estilo_menu)
SELECT 'ampedia','Farmacia Abadía','https://farmaciaabadia.com/cdn/shop/files/Logo_400x120px-03_235x@2x.jpg?v=1694444207',
 '#087F79','#145853','claro'
WHERE EXISTS (SELECT 1 FROM farmetrica.clientes WHERE slug='ampedia')
ON CONFLICT (cliente_slug) DO NOTHING;

-- Corrección de la semilla antigua: solo sustituir el favicon provisional.
-- Nunca sobrescribir un logo que se haya personalizado en el editor.
UPDATE farmetrica.cliente_apariencia
 SET logo_url='https://farmaciaabadia.com/cdn/shop/files/Logo_400x120px-03_235x@2x.jpg?v=1694444207', actualizado_en=now()
WHERE cliente_slug='ampedia'
 AND logo_url='https://farmaciaabadia.com/favicon.ico';
