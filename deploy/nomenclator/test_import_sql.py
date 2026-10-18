import csv
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT=Path(__file__).with_name("import_sql.py")
class ImportSQLTests(unittest.TestCase):
    def test_quote_escaping_and_atomic_batches(self):
        with tempfile.TemporaryDirectory() as d:
            directory=Path(d)
            meta={"sha256":"a"*64,"total_presentaciones":5000,
                  "total_genericos":3000,"fecha_fuente":"2026-10-18"}
            (directory/"meta.json").write_text(json.dumps(meta),encoding="utf8")
            with (directory/"c.csv").open("w",encoding="utf8",newline="") as f:
                writer=csv.writer(f)
                writer.writerow("cn,nombre,laboratorio_codigo,laboratorio,principio_activo,dcpf,dcp,dcsa,generico,comercializado".split(","))
                for i in range(5000):
                    writer.writerow([str(i+100000),"O'Connor 20 mg", "", "",
                         "Molécula","123456","","","true" if i<3000 else "false","true"])
            p=subprocess.run([sys.executable,str(SCRIPT),str(directory/"meta.json"),str(directory/"c.csv")],
                              capture_output=True,text=True,check=True)
            sql=p.stdout
            self.assertTrue(sql.startswith("BEGIN;"))
            self.assertTrue(sql.rstrip().endswith("COMMIT;"))
            self.assertEqual(sql.count("INSERT INTO fm_nomen_stage ("),20)
            self.assertIn("O''Connor 20 mg",sql)
            self.assertNotIn("COPY fm_nomen_stage",sql)
            self.assertIn("Conservada versión vigente",sql)
if __name__=="__main__":
    unittest.main()
