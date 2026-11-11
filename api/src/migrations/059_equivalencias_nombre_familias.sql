-- Reconocer equivalencias adicionales, auditables y conservadoras.
ALTER TABLE farmetrica.familias_globales_alias
 DROP CONSTRAINT IF EXISTS familias_globales_alias_metodo_check;
ALTER TABLE farmetrica.familias_globales_alias
 ADD CONSTRAINT familias_globales_alias_metodo_check
 CHECK (metodo IN ('referencia','coincidencia_cn','coincidencia_nombre','nombre_compartido','sin_referencia','manual'));
