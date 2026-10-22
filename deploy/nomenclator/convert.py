#!/usr/bin/env python3
"""Transforma el ZIP de Prescripción AEMPS a un catálogo oficial por CN.
Conserva titular y comercializador, que NO equivalen necesariamente al fabricante.
No publica el ZIP ni sus XML. Campos según documento técnico AEMPS v15 (2025).
"""
import argparse
import csv
import hashlib
import io
import json
import re
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

COLUMNS = ("cn", "nombre", "laboratorio_codigo", "laboratorio",
           "laboratorio_titular_codigo", "laboratorio_titular",
           "laboratorio_comercializador_codigo", "laboratorio_comercializador",
           "principio_activo", "dcpf", "dcp", "dcsa", "generico", "comercializado")
CN = re.compile(r"^[0-9]{6,7}$")
FIELDS = {
    "cod_nacion", "cod_dcpf", "cod_dcp", "cod_dcsa", "des_prese",
    "des_nomco", "sw_generico", "sw_comercializado",
    "laboratorio_comercializador", "laboratorio_titular", "listprescriptiondate"
}


def local(tag):
    return tag.rsplit("}", 1)[-1].lower().strip()


def children(element):
    return {local(c.tag): (c.text or "").strip() for c in element
            if len(c) == 0 and (c.text or "").strip()}


def text_or(d, *keys):
    return next((d[k] for k in keys if d.get(k)), "")


def dictionary(archive, name, code_aliases, label_aliases):
    """Busca pares código/etiqueta; los XML de diccionarios cambian según edición."""
    file = next((x for x in archive.namelist()
                 if Path(x).name.upper() == name.upper()), None)
    if not file:
        return {}
    result = {}
    with archive.open(file) as handle:
        for _, el in ET.iterparse(handle, events=("end",)):
            fields = children(el)
            code = text_or(fields, *code_aliases)
            label = text_or(fields, *label_aliases)
            if code and label and len(code) <= 100 and len(label) <= 500:
                result.setdefault(code, label)
            if code and label:
                el.clear()
    return result


def parse(archive):
    names = archive.namelist()
    prescription = next((x for x in names
                         if Path(x).name.casefold() == "prescripcion.xml"), None)
    if not prescription:
        raise ValueError("El ZIP no contiene Prescripcion.xml")
    labs = dictionary(
        archive, "DICCIONARIO_LABORATORIOS.xml",
        ["codigolaboratorio", "cod_laboratorio", "codigo", "cod_lab", "cod_labo"],
        ["laboratorio", "nombre", "nombre_laboratorio", "des_laboratorio", "descripcion",
         "des_lab", "nom_labo"])
    substances = dictionary(
        archive, "DICCIONARIO_DCSA.xml",
        ["codigodcsa", "cod_dcsa", "codigo", "cod_snomed"],
        ["nombredcsa", "des_dcsa", "descripcion", "nombre", "denominacion", "denominacion_dcsa"])
    dcpf_names = dictionary(
        archive, "DICCIONARIO_DCPF.xml",
        ["codigodcpf", "cod_dcpf", "codigo", "cod_snomed"],
        ["nombredcpf", "des_dcpf", "descripcion", "nombre", "denominacion"])
    seen = set()
    source_date = ""
    with archive.open(prescription) as handle:
        for _, el in ET.iterparse(handle, events=("end",)):
            values = children(el)
            cn = values.get("cod_nacion", "")
            dcpf = values.get("cod_dcpf", "")
            if cn and dcpf:
                if not CN.fullmatch(cn):
                    el.clear()
                    continue
                if cn in seen:
                    el.clear()
                    continue
                seen.add(cn)
                titular_code = values.get("laboratorio_titular", "")
                comercial_code = values.get("laboratorio_comercializador", "")
                lab_code = titular_code or comercial_code
                source_date = source_date or values.get("listprescriptiondate", "")
                yield {
                    "cn": cn,
                    "nombre": (text_or(values, "des_prese", "des_nomco") or
                               dcpf_names.get(dcpf) or cn)[:450],
                    "laboratorio_codigo": lab_code,
                    "laboratorio": labs.get(lab_code, ""),
                    "laboratorio_titular_codigo": titular_code,
                    "laboratorio_titular": labs.get(titular_code, ""),
                    "laboratorio_comercializador_codigo": comercial_code,
                    "laboratorio_comercializador": labs.get(comercial_code, ""),
                    "principio_activo": substances.get(values.get("cod_dcsa", ""), ""),
                    "dcpf": dcpf,
                    "dcp": values.get("cod_dcp", ""),
                    "dcsa": values.get("cod_dcsa", ""),
                    "generico": "true" if values.get("sw_generico") == "1" else "false",
                    "comercializado": ("true" if values.get("sw_comercializado") == "1"
                                      else "false" if values.get("sw_comercializado") == "0" else ""),
                    "_source_date": source_date,
                }
                el.clear()


def convert(zip_path, csv_path, meta_path, min_records):
    if zip_path.stat().st_size > 300 * 1024 * 1024:
        raise ValueError("Archivo ZIP demasiado grande (>300 MB)")
    digest = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    with zipfile.ZipFile(zip_path) as archive:
        safe = [z for z in archive.infolist() if not z.is_dir()]
        if any(z.file_size > 1_000_000_000 or z.compress_size == 0 and z.file_size
               for z in safe):
            raise ValueError("El ZIP contiene un miembro de tamaño no permitido")
        if sum(z.file_size for z in safe) > 2_000_000_000:
            raise ValueError("Contenido ZIP demasiado grande (>2 GB)")
        extracted = list(parse(archive))
    if len(extracted) < min_records:
        raise ValueError(f"Solo {len(extracted)} presentaciones; no se importa un catálogo incompleto")
    generics = sum(r["generico"] == "true" for r in extracted)
    if generics < max(1, min_records // 6):
        raise ValueError("No se ha reconocido el indicador oficial de medicamentos genéricos")
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        for row in extracted:
            # La fuente puede contener saltos CR/LF en los textos XML; el COPY
            # remoto de psql exige una fila física por registro del CSV.
            writer.writerow({key: " ".join(str(row[key]).split()) for key in COLUMNS})
    date_text = extracted[0].get("_source_date", "")
    source_date = None
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%Y%m%d"):
        try:
            source_date = datetime.strptime(date_text, fmt).date().isoformat()
            break
        except ValueError:
            pass
    meta = {
        "fuente": "AEMPS Nomenclátor de Prescripción",
        "url": "https://listadomedicamentos.aemps.gob.es/prescripcion.zip",
        "sha256": digest,
        "fecha_fuente": source_date,
        "total_presentaciones": len(extracted),
        "total_genericos": generics,
        "fichero": "prescripcion.zip",
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2)+"\n",
                         encoding="utf-8")
    print(json.dumps(meta, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("zip", type=Path)
    parser.add_argument("--csv", type=Path, required=True)
    parser.add_argument("--meta", type=Path, required=True)
    parser.add_argument("--min-records", type=int, default=5000)
    args = parser.parse_args()
    convert(args.zip, args.csv, args.meta, args.min_records)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, zipfile.BadZipFile, ET.ParseError) as exc:
        print(f"Error de Nomenclátor: {exc}", file=sys.stderr)
        sys.exit(1)
