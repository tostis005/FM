#!/usr/bin/env python3
"""Emite un flujo psql transaccional (metadatos saneados + CSV) a stdout."""
import csv
import json
import re
import sys
from pathlib import Path

FIELDS = "cn,nombre,laboratorio_codigo,laboratorio,principio_activo,dcpf,dcp,dcsa,generico,comercializado"
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
          "principio_activo text,dcpf text,dcp text,dcsa text,"
          "generico boolean,comercializado boolean) ON COMMIT DROP;")
    print("COPY fm_nomen_stage ("+FIELDS+") FROM STDIN WITH (FORMAT csv,HEADER true);")
    with csv_path.open("r",encoding="utf-8",newline="") as handle:
        sys.stdout.write(handle.read().rstrip("\n")+"\n")
    print(r"\.")
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
      (cn,nombre,laboratorio_codigo,laboratorio,principio_activo,dcpf,dcp,dcsa,
       generico,comercializado,actualizado_en)
      SELECT cn,nombre,nullif(laboratorio_codigo,''),nullif(laboratorio,''),
       nullif(principio_activo,''),dcpf,nullif(dcp,''),nullif(dcsa,''),
       generico,comercializado,now()
      FROM fm_nomen_stage
      ON CONFLICT (cn) DO UPDATE SET
       nombre=excluded.nombre,laboratorio_codigo=excluded.laboratorio_codigo,
       laboratorio=excluded.laboratorio,principio_activo=excluded.principio_activo,
       dcpf=excluded.dcpf,dcp=excluded.dcp,dcsa=excluded.dcsa,
       generico=excluded.generico,comercializado=excluded.comercializado,
       actualizado_en=now();""")
    print("DELETE FROM farmetrica.nomenclator_presentaciones p "
          "WHERE NOT EXISTS(SELECT 1 FROM fm_nomen_stage st WHERE st.cn=p.cn);")
    print("UPDATE farmetrica.nomenclator_versiones SET activo=false WHERE activo;")
    print("INSERT INTO farmetrica.nomenclator_versiones "
          "(fuente,sha256,fecha_fuente,total_presentaciones,total_genericos,fichero,activo)"
          f" VALUES('AEMPS Nomenclátor de Prescripción','{sha}',"
          f"{chr(39)+date+chr(39) if date else 'NULL'},"
          f"{rows},{generics},'prescripcion.zip',true);")
    print("COMMIT;")

if __name__=="__main__":
    main()
