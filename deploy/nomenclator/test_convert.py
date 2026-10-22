import csv
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from convert import convert

def xml(rows):
    def el(row):
        return "<prescripcion>"+''.join(f"<{k}>{v}</{k}>" for k,v in row.items())+"</prescripcion>"
    return "<listado>"+''.join(el(r) for r in rows)+"</listado>"

class ConverterTest(unittest.TestCase):
    def test_mapping_and_generic_flag_are_official(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); src=root/"prescripcion.zip"
            sample=[
                dict(cod_nacion="654321",cod_dcpf="123456789",cod_dcp="98765",
                     cod_dcsa="101",des_prese="Medicamento A\n presentación especial",sw_generico="1",
                     sw_comercializado="1",laboratorio_comercializador="LAB02",
                     laboratorio_titular="LAB01",
                     listprescriptiondate="18/10/2026"),
                dict(cod_nacion="654322",cod_dcpf="123456789",cod_dcp="98765",
                     cod_dcsa="101",des_prese="Medicamento B",sw_generico="1",
                     sw_comercializado="0",laboratorio_comercializador="LAB02",
                     laboratorio_titular="LAB01"),
                dict(cod_nacion="654323",cod_dcpf="123456789",cod_dcp="98765",
                     des_prese="Marca de referencia",sw_generico="0"),
            ]
            with zipfile.ZipFile(src,"w") as z:
                z.writestr("datos/Prescripcion.xml",xml(sample))
                # Estructura VERIFICADA del ZIP real AEMPS de octubre de 2026.
                z.writestr("dic/DICCIONARIO_LABORATORIOS.xml",
                 '<aemps_prescripcion_laboratorios xmlns="http://schemas.aemps.es/prescripcion/aemps_prescripcion_laboratorios">'
                 "<laboratorios><codigolaboratorio>LAB01</codigolaboratorio>"
                 "<laboratorio>Laboratorio Titular Alfa</laboratorio></laboratorios>"
                 "<laboratorios><codigolaboratorio>LAB02</codigolaboratorio>"
                 "<laboratorio>Laboratorio Comercializador Beta</laboratorio></laboratorios>"
                 "</aemps_prescripcion_laboratorios>")
                z.writestr("dic/DICCIONARIO_DCSA.xml",
                 "<root><dcsa><codigodcsa>101</codigodcsa>"
                 "<nombredcsa>Omeprazol</nombredcsa></dcsa></root>")
                z.writestr("dic/DICCIONARIO_DCPF.xml",
                 "<root><dcpf><codigodcpf>123456789</codigodcpf>"
                 "<nombredcpf>Omeprazol cápsulas</nombredcpf></dcpf></root>")
            out=root/"csv.csv"; meta=root/"meta.json"
            convert(src,out,meta,2)
            rows=list(csv.DictReader(out.open(encoding="utf8")))
            self.assertEqual(len(rows),3)
            self.assertEqual([r["dcpf"] for r in rows],["123456789"]*3)
            self.assertEqual(rows[0]["laboratorio"],"Laboratorio Titular Alfa")
            self.assertEqual(rows[0]["laboratorio_titular_codigo"],"LAB01")
            self.assertEqual(rows[0]["laboratorio_titular"],"Laboratorio Titular Alfa")
            self.assertEqual(rows[0]["laboratorio_comercializador_codigo"],"LAB02")
            self.assertEqual(rows[0]["laboratorio_comercializador"],"Laboratorio Comercializador Beta")
            self.assertEqual(rows[1]["laboratorio_titular"],"Laboratorio Titular Alfa")
            self.assertEqual(rows[1]["laboratorio_comercializador"],"Laboratorio Comercializador Beta")
            self.assertEqual(rows[0]["nombre"],"Medicamento A presentación especial")
            self.assertEqual(rows[1]["nombre"],"Medicamento B")
            self.assertNotEqual(rows[0]["nombre"],"Omeprazol cápsulas")
            self.assertEqual(rows[0]["principio_activo"],"Omeprazol")
            self.assertEqual(rows[0]["generico"],"true")
            self.assertEqual(rows[2]["generico"],"false")
            self.assertEqual(rows[1]["comercializado"],"false")
            self.assertEqual(json.loads(meta.read_text())["fecha_fuente"],"2026-10-18")

    def test_fails_closed_if_zip_is_incomplete(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);src=root/"a.zip"
            with zipfile.ZipFile(src,"w") as z:
                z.writestr("otro.xml","<root/>")
            with self.assertRaises(ValueError):
                convert(src,root/"out.csv",root/"meta.json",2)

if __name__=="__main__":
    unittest.main()
