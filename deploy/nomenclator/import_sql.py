#!/usr/bin/env python3
"""Emite importación psql transaccional por lotes sin COPY ni ficheros persistentes."""
import csv
import json
import re
import sys
from pathlib import Path

FIELDS = ("cn,nombre,laboratorio_codigo,laboratorio,"
          "laboratorio_titular_codigo,laboratorio_titular,"
          "laboratorio_comercializador_codigo,laboratorio_comercializador,"
          "principio_activo,dcpf,dcp,dcsa,generico,comercializado")
def main():
    metadata=json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    csv_path=Path(sys.argv[2])
    sha=metadata["sha256"]
    date=metadata.get("fecha_fuente") or ""
    rows=metadata["total_presentaciones"]
    generics=metadata["total_genericos"]
    assert re.fullmatch(r"[0-9a-f]{64}",sha)
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}|",date)
    assert isinstance(rows,int) and rows >= 5000
    assert isinstance(generics,int) and generics >= 1000
    assert csv_path.is_file()
    print("BEGIN;")
    print("SET LOCAL lock_timeout='15s';")
    print("CREATE TEMP TABLE fm_nomen_stage ("
          "cn text,nombre text,laboratorio_codigo text,laboratorio text,"
          "laboratorio_titular_codigo text,laboratorio_titular text,"
          "laboratorio_comercializador_codigo text,laboratorio_comercializador text,"
          "principio_activo text,dcpf text,dcp text,dcsa text,"
          "generico boolean,comercializado boolean) ON COMMIT DROP;")
    # PostgreSQL COPY FROM STDIN puede fallar con finales de línea de los XML
    # oficiales al atravesar psql+SSH. Insertar lotes SQL bien escapados evita
    # la terminación ambigua del flujo; todo sigue dentro de una transacción.
    def literal(value):
        if value is None or value == "":
            return "NULL"
        if "\\x00" in value:
            raise ValueError("Entrada XML contiene NUL")
        return "'" + value.replace("'", "''") + "'"

    batch = []
    actual = 0
    with csv_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for item in reader:
            actual += 1
            vals = [literal(item.get(field)) for field in FIELDS.split(",")]
            batch.append("(" + ",".join(vals) + ")")
            if len(batch) >= 250:
                print("INSERT INTO fm_nomen_stage ("+FIELDS+") VALUES " +
                      ",".join(batch) + ";")
                batch.clear()
        if batch:
            print("INSERT INTO fm_nomen_stage ("+FIELDS+") VALUES " +
                  ",".join(batch) + ";")
    if actual != rows:
        raise ValueError(f"Recuento CSV inconsistente: {actual} frente a {rows}")
    print("""DO $nomen$
      BEGIN
        IF (SELECT count(*) FROM fm_nomen_stage)<5000 OR
           (SELECT count(*) FROM fm_nomen_stage WHERE generico)<1000 OR
           (SELECT count(*) FROM fm_nomen_stage WHERE cn !~ '^[0-9]{6,7}$')>0 OR
           (SELECT count(*) FROM fm_nomen_stage WHERE dcpf IS NULL OR dcpf='')>0 OR
           (SELECT count(DISTINCT cn) FROM fm_nomen_stage)<>(SELECT count(*) FROM fm_nomen_stage)
        THEN RAISE EXCEPTION 'AEMPS: datos incompletos o inválidos. Conservada versión vigente.';
        END IF;
      END $nomen$;""")
    print("""INSERT INTO farmetrica.nomenclator_presentaciones
      (cn,nombre,laboratorio_codigo,laboratorio,
       laboratorio_titular_codigo,laboratorio_titular,
       laboratorio_comercializador_codigo,laboratorio_comercializador,
       principio_activo,dcpf,dcp,dcsa,generico,comercializado,actualizado_en)
      SELECT cn,nombre,nullif(laboratorio_codigo,''),nullif(laboratorio,''),
       nullif(laboratorio_titular_codigo,''),nullif(laboratorio_titular,''),
       nullif(laboratorio_comercializador_codigo,''),nullif(laboratorio_comercializador,''),
       nullif(principio_activo,''),dcpf,nullif(dcp,''),nullif(dcsa,''),
       generico,comercializado,now()
      FROM fm_nomen_stage
      ON CONFLICT (cn) DO UPDATE SET
       nombre=excluded.nombre,laboratorio_codigo=excluded.laboratorio_codigo,
       laboratorio=excluded.laboratorio,
       laboratorio_titular_codigo=excluded.laboratorio_titular_codigo,
       laboratorio_titular=excluded.laboratorio_titular,
       laboratorio_comercializador_codigo=excluded.laboratorio_comercializador_codigo,
       laboratorio_comercializador=excluded.laboratorio_comercializador,
       principio_activo=excluded.principio_activo,
       dcpf=excluded.dcpf,dcp=excluded.dcp,dcsa=excluded.dcsa,
       generico=excluded.generico,comercializado=excluded.comercializado,
       actualizado_en=now();""")
    print("DELETE FROM farmetrica.nomenclator_presentaciones p "
          "WHERE NOT EXISTS(SELECT 1 FROM fm_nomen_stage st WHERE st.cn=p.cn);")
    print("UPDATE farmetrica.nomenclator_versiones SET activo=false WHERE activo;")
    print("INSERT INTO farmetrica.nomenclator_versiones "
          "(fuente,sha256,fecha_fuente,total_presentaciones,total_genericos,fichero,transformacion_version,activo)"
          f" VALUES('AEMPS Nomenclátor de Prescripción','{sha}',"
          f"{chr(39)+date+chr(39) if date else 'NULL'},"
          f"{rows},{generics},'prescripcion.zip',2,true)"
      " ON CONFLICT (sha256) DO UPDATE SET "
      "importado_en=now(),fecha_fuente=excluded.fecha_fuente,"
      "total_presentaciones=excluded.total_presentaciones,"
      "total_genericos=excluded.total_genericos,"
      "transformacion_version=excluded.transformacion_version,activo=true;")
    print("COMMIT;")

if __name__=="__main__":
    main()
