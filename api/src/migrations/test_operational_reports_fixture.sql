-- SOLO CI sobre una base efímera. Nunca ejecutar en producción.
CREATE TABLE IF NOT EXISTS ampedia.articulos (
 farmacia_codigo text,origen_id text,nombre text,codigo_nacional text,
 familia text,laboratorio text,pvp numeric,puc numeric,pmc numeric,
 sincronizado_en timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ampedia.compras (
 farmacia_codigo text,origen_id text,fecha timestamp,articulo_id text,
 proveedor_id text,unidades numeric,coste_unitario numeric,importe numeric,
 proveedor_nombre text,sincronizado_en timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ampedia.proveedores (
 farmacia_codigo text,origen_id text,nombre text,sincronizado_en timestamptz DEFAULT now()
);
INSERT INTO ampedia.articulos(farmacia_codigo,origen_id,nombre,codigo_nacional,familia,laboratorio,pvp,puc,pmc)
VALUES ('ABA','ART-01','Omeprazol A','654321','Digestivo','Lab A',8,2.1,2.5),
       ('ABA','ART-02','Omeprazol B','654322','Digestivo','Lab B',8,1.9,2.3);
INSERT INTO ampedia.proveedores(farmacia_codigo,origen_id,nombre)
VALUES ('ABA','PR1','Mayorista 1'),('ABA','PR2','Mayorista 2');
INSERT INTO ampedia.compras(farmacia_codigo,origen_id,fecha,articulo_id,proveedor_id,unidades,coste_unitario,importe,proveedor_nombre)
VALUES ('ABA','B1','2026-10-01','ART-01','PR1',10,2,20,'Mayorista 1'),
       ('ABA','B2','2026-10-04','ART-01','PR1',5,3,15,'Mayorista 1'),
       ('ABA','B3','2026-10-08','ART-01','PR1',5,4,20,'Mayorista 1'),
       ('ABA','B4','2026-10-01','ART-02','PR2',10,1,10,'Mayorista 2'),
       ('ABA','B5','2026-10-04','ART-02','PR2',10,1.2,12,'Mayorista 2'),
       ('ABA','B6','2026-10-08','ART-02','PR2',10,1.3,13,'Mayorista 2');
INSERT INTO ampedia.ventas(farmacia_codigo,origen_id,fecha,articulo_id,unidades,importe)
VALUES ('ABA','V2','2026-10-10','ART-02',2,16);
INSERT INTO farmetrica.nomenclator_versiones(fuente,sha256,total_presentaciones,total_genericos,fichero,activo)
VALUES ('Fixture AEMPS','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',2,2,'test.zip',true);
INSERT INTO farmetrica.nomenclator_presentaciones(cn,nombre,dcpf,dcp,generico)
VALUES ('654321','Omeprazol A','123456789','123456',true),
       ('654322','Omeprazol B','123456789','123456',true);

-- Los IDs de ERP son LOCALES: PR1 y ART-03 en EUR no se deben mezclar con ABA.
INSERT INTO ampedia.articulos(farmacia_codigo,origen_id,nombre,codigo_nacional,familia,laboratorio,pvp,puc,pmc)
VALUES ('EUR','ART-03','Omeprazol C','654321','Digestivo','Lab C',7,1.8,2.4);
INSERT INTO ampedia.proveedores(farmacia_codigo,origen_id,nombre)
VALUES ('EUR','PR1','Mayorista Europa');
INSERT INTO ampedia.compras(farmacia_codigo,origen_id,fecha,articulo_id,proveedor_id,unidades,coste_unitario,importe,proveedor_nombre)
VALUES ('EUR','B7','2026-10-06','ART-03','PR1',10,1.8,18,'Mayorista Europa');
-- Una farmacia con stock reciente no debe refrescar la antigüedad de otra.
INSERT INTO public.stock_farmacia(id_farmacia,id_articu,descripcion,stock_actual,importado_en)
VALUES (1,'ART-01','Omeprazol A',8,now()),
       (2,'ART-03','Omeprazol C',9,now()-interval '4 days');
