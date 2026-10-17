// Contenido editorial de las páginas públicas de Farmetrica.
// Una URL por intención de búsqueda; no publicar como operativas integraciones previstas.
export const solutions=[
{
slug:"gestion-promociones-farmacia",category:"Gestión de promociones",title:"Software para gestionar promociones en farmacias",
description:"Organiza campañas comerciales de farmacia por CN, fechas, condiciones y farmacias participantes. Define objetivos y revisa resultados en Farmetrica.",
hero:"Tus promociones merecen algo mejor que otra hoja de cálculo.",
lead:"Preparar una campaña es sencillo. Lo difícil es coordinar productos, farmacias, fechas y resultados sin perder el control. Farmetrica reúne la definición de la promoción y su seguimiento comercial en un mismo espacio.",
value:"Del lanzamiento al resultado, sin perseguir archivos.",
sections:[
{heading:"Toda la información de la campaña, en su sitio",paragraphs:["Un nombre claro, un laboratorio, una descripción comercial, el periodo de vigencia, los códigos nacionales incluidos y las farmacias participantes. Son datos que normalmente viajan en correos y hojas de cálculo; reunirlos reduce discrepancias.","En Farmetrica las campañas pueden crearse y consultarse con ese contexto. También es posible importar promociones desde Excel cuando el documento presenta una estructura compatible."],points:["Referencias identificadas por CN en la instalación española actual.","Ofertas y condiciones comerciales asociadas a cada campaña.","Farmacias participantes con sus objetivos en unidades.","Estados para distinguir campañas en preparación, activas y finalizadas."]},
{heading:"Una promoción no es igual en cada farmacia",paragraphs:["Una campaña global puede tener cinco farmacias y cinco metas distintas. El seguimiento por punto de venta ayuda a entender dónde se cumple el objetivo y dónde conviene revisar la ejecución. Así evitas confundir un buen total con una buena distribución de resultados.","Al seleccionar varias campañas, Farmetrica muestra también una visión consolidada. Si seleccionas solo una, concentra la información en esa campaña para no repetir cifras."]},
{heading:"Resultados apoyados en datos comerciales",paragraphs:["Cuando existe conexión con el sistema de gestión, el cálculo parte de ventas registradas. El entorno actual usa ventas de Farmatic a través de PostgreSQL; la compatibilidad con otros programas se evalúa por separado.","El responsable puede contrastar unidades vendidas, objetivo y porcentaje de avance, consultar el detalle y preparar los informes de laboratorio necesarios."]}
],
faq:[
["¿Puedo introducir varias referencias en una promoción?","Sí. La campaña contempla varios códigos nacionales, sus fechas y las condiciones comerciales que correspondan."],
["¿Se pueden importar promociones desde Excel?","Sí, con archivos y hojas compatibles con el importador. Se revisan las coincidencias para no asignar objetivos a campañas equivocadas."],
["¿Se registran ventas manuales como reales?","No. Cuando está disponible la integración, las ventas mostradas proceden del sistema de origen, no de cifras ilustrativas del Excel."]
],
related:["/soluciones/objetivos-venta-farmacias/","/soluciones/seguimiento-ventas-farmacia/","/soluciones/importar-campanas-excel/"]
},
{
slug:"objetivos-venta-farmacias",category:"Objetivos comerciales",title:"Objetivos de venta por farmacia y campaña",
description:"Define objetivos de unidades distintos por farmacia para cada promoción. Compara avances individuales y consolidados con Farmetrica.",
hero:"Un objetivo para cada farmacia. Una visión para toda tu red.",
lead:"No todas las farmacias tienen el mismo volumen, histórico o capacidad de venta. Un objetivo único para toda la red oculta las diferencias. Por eso Farmetrica permite trabajar con metas específicas por farmacia y promoción.",
value:"De una meta global a decisiones concretas.",
sections:[
{heading:"Metas que corresponden a la realidad de cada punto de venta",paragraphs:["Una campaña de higiene bucal puede proponerse vender quince unidades en una farmacia y ocho en otra. Ambas metas deben analizarse por separado antes de sumarlas.","La configuración por farmacia hace posible revisar unidades previstas, unidades vendidas y porcentaje de cumplimiento sin perder el contexto de cada centro."],points:["Objetivos expresados en unidades.","Participación explícita de las farmacias.","Visión individual y consolidada cuando seleccionas varias campañas.","Seguimiento del avance durante las fechas de vigencia."]},
{heading:"Importa objetivos sin volver a teclearlos",paragraphs:["En muchas redes el reparto comercial nace en una hoja de Excel. Farmetrica contempla la importación de objetivos por farmacia cuando el fichero contiene esa información.","Las celdas vacías no equivalen a cero ventas. Y si una campaña presenta nombres ambiguos, conviene revisar su conciliación antes de asignar objetivos automáticamente."]},
{heading:"Más información para la reunión comercial",paragraphs:["Comparar objetivos y ventas entre farmacias no sirve solo para elaborar un ranking. Permite detectar diferencias relevantes, revisar el surtido o la visibilidad de una campaña y decidir dónde concentrar el esfuerzo comercial.","La plataforma ofrece filtros y páginas cortas para llegar al dato que importa, sin desplazar interminablemente una hoja de cálculo."]}
],
faq:[
["¿Es obligatorio que todas las farmacias participen en una campaña?","No. Cada promoción identifica las farmacias participantes y los objetivos asociados."],
["¿Qué ocurre si una farmacia no tiene objetivo asignado?","Debe distinguirse entre objetivo pendiente o no asignado y una meta numérica de cero."],
["¿Se pueden ver metas de varias promociones juntas?","Sí. Al seleccionar más de una campaña, el seguimiento puede reunir sus objetivos y ventas por farmacia."]
],
related:["/soluciones/gestion-promociones-farmacia/","/soluciones/cuadro-mando-farmacias/","/blog/errores-al-definir-objetivos/"]
},
{
slug:"seguimiento-ventas-farmacia",category:"Seguimiento comercial",title:"Seguimiento de ventas de promociones de farmacia",
description:"Consulta las ventas de promociones por farmacia, periodo y código nacional. Contrasta unidades vendidas y objetivos con datos de origen.",
hero:"La campaña empieza al lanzarla. El valor aparece al seguirla.",
lead:"¿Cuántas unidades se han vendido? ¿Qué farmacias avanzan? ¿De dónde sale cada cifra? El seguimiento comercial convierte esas preguntas en consultas claras para actuar durante la campaña, no solo al final.",
value:"Ventas frente a objetivos, con contexto.",
sections:[
{heading:"Del dato de venta al progreso comercial",paragraphs:["El seguimiento combina los identificadores de producto de la promoción, su periodo y las farmacias incluidas. En el origen español conectado se utilizan CN. Cuando se dispone de una conexión operativa, los datos proceden de las líneas de venta del sistema de farmacia.","En el entorno actual, Farmetrica consulta datos de Farmatic cargados en PostgreSQL. Esta diferencia es importante: una cifra de ejemplo o un fichero recibido por correo no debe confundirse con ventas contrastadas."],points:["Unidades vendidas por farmacia.","Comparación con el objetivo asignado.","Porcentaje de cumplimiento.","Detalle de tickets disponible para usuarios autorizados."]},
{heading:"Filtros que ayudan a responder una pregunta concreta",paragraphs:["El responsable no debería tener que descargar diez archivos para comprobar una duda. Puede acotar campañas, farmacias y CNs; ordenar resultados y consultar páginas de registros manejables.","Las tablas disponen de filtros multiselección en campos como farmacia o CN. En el detalle de tickets, los filtros se aplican a la consulta en PostgreSQL, no únicamente a la página visible."]},
{heading:"Una sola campaña o varias",paragraphs:["Con una campaña seleccionada interesa analizar su avance sin duplicar el resumen. Con varias, el consolidado ayuda a entender el impacto conjunto y descubrir qué farmacias concentran los resultados.","Esta forma de organizar la información favorece tanto la reunión operativa de una farmacia como la revisión global de una red."]}
],
faq:[
["¿Las ventas se actualizan automáticamente en todos los programas de gestión?","No. Depende de la conexión implantada y del proceso de actualización de cada fuente. La integración activa conocida utiliza Farmatic."],
["¿Puedo consultar el detalle que origina un resultado?","La aplicación dispone de una consulta de tickets para usuarios autorizados en los entornos con datos reales conectados."],
["¿El total de varias campañas puede sumar ventas del mismo producto?","Si varias campañas comparten CN y periodo, conviene revisar posibles solapamientos antes de interpretar la suma comercial."]
],
related:["/soluciones/objetivos-venta-farmacias/","/soluciones/reporting-laboratorios/","/blog/indicadores-promociones-farmacia/"]
},
{
slug:"cuadro-mando-farmacias",category:"Analítica",title:"Cuadro de mando e inteligencia de negocio para farmacias",
description:"Analiza ventas, compras, stock, proveedores, artículos y rentabilidad de tu farmacia o red, según las fuentes conectadas y validadas.",
hero:"Toda tu farmacia de un vistazo. El detalle para decidir.",
lead:"Un cuadro de mando útil ayuda a relacionar actividad, costes, productos y existencias para identificar dónde actuar. Farmetrica organiza esas áreas en una plataforma, incorporando información a medida que se conectan fuentes verificadas.",
value:"Una visión de negocio, desde el indicador hasta cada artículo.",
sections:[{"heading":"Los indicadores del negocio, en contexto","paragraphs":["Consulta tendencias de ventas y actividad comercial por periodo y farmacia. Cuando están disponibles las compras y el inventario, amplía el análisis a costes, proveedores, stock y márgenes.","Una instalación puede disponer solo de ventas al principio. Farmetrica debe distinguir las fuentes conectadas de los módulos que requieren completar su integración."],"points":["Ventas, unidades y evolución.","Compras y costes por proveedor, con datos disponibles.","Stock, rotación y necesidades de reposición, con inventario validado.","Rendimiento de artículos y rentabilidad, con costes y criterios verificados."]},{"heading":"De la red al establecimiento","paragraphs":["Los indicadores consolidados ganan valor cuando permiten explorar cada punto de venta, artículo y periodo.","La visibilidad y las comparaciones dependen de las farmacias y módulos autorizados para cada usuario."]},{"heading":"Información para decidir, no gráficos por acumular","paragraphs":["El objetivo es encontrar oportunidades de ahorro, diferencias de precios, referencias de baja rotación y tendencias de rentabilidad.","Las promociones y los objetivos comerciales constituyen una función adicional, no el núcleo del cuadro de mando."]}],
faq:[["¿Farmetrica es solo una herramienta de promociones?","No. La visión de producto abarca ventas, compras, proveedores, artículos, stock y rentabilidad; las campañas son un módulo complementario."],["¿Puedo analizar varias farmacias?","El modelo contempla una visión individual y consolidada con los permisos y datos efectivamente disponibles."],["¿Los márgenes están siempre disponibles?","No. Requieren costes y reglas de negocio validados. La conexión confirmada actualmente proporciona datos de ventas de Farmatic."]],
related:["/soluciones/ventas-farmacia/","/soluciones/analisis-compras-farmacia/","/soluciones/rentabilidad-farmacia/"]
},
{
slug:"reporting-laboratorios",category:"Reporting",title:"Informes de ventas para laboratorios farmacéuticos",
description:"Prepara Excel de ventas por promoción para laboratorios: ticket, fecha, CN, unidades, PVP, importes y descuento. ZIP al seleccionar varias campañas.",
hero:"Del seguimiento de la promoción al Excel que necesita el laboratorio.",
lead:"Las campañas acordadas con un laboratorio suelen terminar con una petición de resultados. Farmetrica reúne el detalle de líneas vendidas de las promociones seleccionadas para preparar entregas más consistentes.",
value:"Un Excel por campaña. Sin copiar y pegar tickets.",
sections:[
{heading:"Datos que permiten revisar una acción comercial",paragraphs:["El archivo de laboratorio parte de las ventas disponibles en el origen conectado y conserva las columnas útiles para contrastar cada operación: farmacia, identificador de vendedor, documento de venta, fecha y hora, CN, descripción, unidades e importes.","También pueden incluirse PVP, bruto, descuento de línea y neto según el esquema disponible. Los datos se refieren a operaciones comerciales; el destinatario debe gestionarlos con las salvaguardas correspondientes."],points:["Excel (.xlsx) para una promoción.","Archivo ZIP si seleccionas varias promociones.","Un Excel independiente dentro del ZIP por cada campaña.","Consultas paginadas de origen, sin limitar la exportación a lo visible en pantalla."]},
{heading:"Una entrega coherente con la selección",paragraphs:["La exportación principal de Seguimiento utiliza los CNs y fechas definidos en cada campaña. Los filtros manuales de la consulta de tickets no cambian silenciosamente el alcance de los archivos del laboratorio.","Si no se puede recuperar la totalidad de las líneas dentro de los límites configurados, la aplicación avisa antes de presentar un archivo incompleto."]},
{heading:"La importancia de la trazabilidad",paragraphs:["Informar de un total de unidades es diferente de aportar las operaciones que lo sustentan. Mantener referencias, periodo y farmacia facilita revisar discrepancias o aclarar una liquidación con el laboratorio.","Los objetivos comerciales son un indicador de seguimiento, pero no sustituyen la información de venta registrada ni acreditan por sí solos una liquidación económica."]}
],
faq:[
["¿Puedo descargar varios informes de una vez?","Sí. En Seguimiento puedes seleccionar varias campañas y generar un ZIP con un archivo por promoción."],
["¿De dónde salen las ventas?","Del origen comercial conectado. En el entorno actualmente implantado se utilizan datos de Farmatic consultados mediante PostgreSQL."],
["¿El archivo se genera aunque falten registros?","La exportación incluye controles para evitar presentar como completa una descarga que no se ha podido terminar."]
],
related:["/soluciones/seguimiento-ventas-farmacia/","/soluciones/gestion-promociones-farmacia/","/blog/como-preparar-informe-laboratorio/"]
},
{
slug:"grupos-de-farmacias",category:"Redes y grupos",title:"Inteligencia de negocio para grupos y redes de farmacias",
description:"Compara ventas, compras, stock, proveedores, artículos y rentabilidad de varias farmacias, con un modelo de datos común y permisos por usuario.",
hero:"Toda tu red, con una visión global y el detalle de cada farmacia.",
lead:"Una red necesita entender el conjunto sin perder las particularidades de cada establecimiento. Farmetrica organiza datos comerciales de distintas farmacias para comparar actividad, compras, inventario y resultados cuando existen fuentes verificadas.",
value:"Un criterio común para comparar sin perder el contexto local.",
sections:[{"heading":"Una visión de conjunto","paragraphs":["Unifica criterios de análisis para revisar actividad, periodos y referencias en cada punto de venta y en toda la red.","Cada farmacia puede tener distinta demanda, surtido y estructura de datos. La comparación requiere normalizarlos."]},{"heading":"Compras, proveedores y stock","paragraphs":["Cuando se dispone de compras y existencias verificadas, el grupo puede contrastar precios de adquisición, concentración de proveedores y cobertura entre farmacias.","La rentabilidad exige además costes adecuados, impuestos y criterios de cálculo compartidos."]},{"heading":"Responsabilidades y acceso","paragraphs":["Los clientes, farmacias, módulos y usuarios cuentan con una estructura de permisos que debe validarse en cada implantación.","La organización de promociones y objetivos por farmacia sigue existiendo como una función adicional, sin definir el alcance completo de la plataforma."]}],
faq:[["¿Se pueden comparar farmacias?","Sí, cuando los establecimientos tengan fuentes de datos conectadas y ámbitos de acceso configurados."],["¿Se consolida también el stock?","Requiere un origen de inventario conectado y validado para cada farmacia."],["¿Se admiten programas de gestión diferentes?","El diseño es independiente del origen, pero cada integración necesita adaptación y pruebas técnicas."]],
related:["/soluciones/cuadro-mando-farmacias/","/soluciones/analisis-proveedores-farmacia/","/integraciones/"]
},
{
slug:"importar-campanas-excel",category:"Importaciones",title:"Importar promociones y objetivos desde Excel",
description:"Transforma hojas Excel de promociones en campañas con CNs, fechas, ofertas y objetivos por farmacia, respetando los datos de ventas de origen.",
hero:"El Excel puede ser el comienzo. No tiene por qué ser todo el proceso.",
lead:"Los laboratorios envían campañas, códigos nacionales y metas en archivos que no siempre tienen la misma estructura. Importarlos de forma controlada permite ahorrar trabajo y continuar el seguimiento en una herramienta común.",
value:"Menos transcripciones, menos errores de conciliación.",
sections:[
{heading:"Qué información conviene importar",paragraphs:["Una promoción requiere su denominación, referencias por CN, condiciones comerciales y periodo. Cuando el archivo lo incluye, también puede detallar qué farmacias participan y cuántas unidades se espera vender en cada una.","Farmetrica cuenta con importación de campañas y objetivos para hojas compatibles. No todos los Excel son idénticos: la estructura y los nombres de columnas deben poder interpretarse correctamente."],points:["Denominación de campaña y laboratorio.","CNs de los productos implicados.","Condiciones, fechas y estado inicial.","Objetivos por farmacia cuando figuran en el archivo."]},
{heading:"Conciliar antes de sobrescribir",paragraphs:["Puede haber dos campañas con el mismo laboratorio y promociones de descuentos diferentes. Por eso no basta con comparar nombres de forma aproximada para decidir qué objetivo corresponde a cuál.","La importación debe identificar coincidencias por laboratorio, gama y oferta, conservar información preexistente que no cambia y señalar situaciones ambiguas para revisarlas."]},
{heading:"Importar objetivos no significa importar ventas",paragraphs:["En algunos Excel aparece una columna con unidades vendidas. Si el sistema de farmacia está conectado, los tickets reales deben seguir siendo la fuente para el seguimiento; el archivo se utiliza para definir la campaña y sus metas.","Esta separación impide que una cifra pasada o ilustrativa se confunda con resultados comerciales actualizados."]}
],
faq:[
["¿Sirve cualquier Excel sin prepararlo?","No. La importación requiere una estructura compatible y una conciliación adecuada de los campos."],
["¿Puede cambiar objetivos de campañas ya existentes?","Sí, para campañas identificadas correctamente, incluso si sus CNs no cambian."],
["¿Se usan las ventas del Excel como datos reales?","No cuando existe origen conectado. El archivo sirve para importar campaña y objetivos; el seguimiento se fundamenta en la fuente de ventas."]
],
related:["/soluciones/gestion-promociones-farmacia/","/soluciones/objetivos-venta-farmacias/","/blog/errores-al-definir-objetivos/"]
},
{
slug:"gestion-usuarios-farmacias",category:"Accesos",title:"Usuarios, roles y permisos para grupos de farmacias",
description:"Gestiona accesos y permisos de equipos y responsables a los distintos módulos de análisis y gestión de una red de farmacias.",
hero:"La información correcta para cada responsabilidad.",
lead:"Los equipos de farmacia necesitan acceder a diferentes datos y módulos según su responsabilidad. Farmetrica organiza clientes, usuarios, farmacias y ámbitos autorizados.",
value:"Una plataforma compartida requiere control de accesos.",
sections:[{"heading":"Una experiencia adaptada a cada rol","paragraphs":["Los administradores configuran usuarios, roles y módulos, y delimitan el ámbito de los datos que deben consultar.","Los permisos se validan en el servidor; ocultar una pantalla no sustituye a la autorización."]},{"heading":"Visión local y de grupo","paragraphs":["Un responsable local trabaja con las farmacias a las que tiene acceso. Un gestor de red puede necesitar información consolidada cuando su perfil lo permita.","Este modelo se aplica a ventas, compras, stock, proveedores y otras áreas de análisis."]},{"heading":"Autenticación segura","paragraphs":["La aplicación privada está separada del sitio público y requiere acceso autenticado.","Los mecanismos de SSO corporativo dependen de la identidad y configuración de cada instalación."]}],
faq:[["¿Puedo asignar usuarios por farmacia?","La estructura de clientes y farmacias permite configurar ámbitos y responsabilidades."],["¿Puede cada usuario consultar todos los módulos?","Solo los habilitados en su cliente y perfil."],["¿El sitio público muestra datos privados?","No. El acceso a datos operativos requiere autenticación y permisos."]],
related:["/soluciones/grupos-de-farmacias/","/soluciones/cuadro-mando-farmacias/","/"]
}
];

export const integrations=[
{
slug:"farmatic",category:"Origen conectado",title:"Farmatic y Farmetrica: análisis de datos de farmacia",
description:"Cómo se aprovechan las ventas de Farmatic en Farmetrica y qué requiere ampliar el análisis a compras, stock, proveedores y rentabilidad.",
hero:"Tus datos de Farmatic, con otra perspectiva de negocio.",
lead:"Farmetrica cuenta con una conexión operativa a datos de ventas procedentes de Farmatic, consultados desde PostgreSQL en una instalación. El análisis integral requiere incorporar otras fuentes de compras, costes e inventario después de validarlas.",
value:"Ventas conectadas en un entorno; ampliación condicionada a nuevas fuentes.",
sections:[{"heading":"Ventas con el detalle necesario","paragraphs":["Los movimientos de ventas se consultan por producto, fecha y farmacia, respetando las referencias y permisos de origen.","Las devoluciones y los importes dependen del contrato de datos disponible y de las reglas validadas para la instalación."]},{"heading":"Hacia el análisis completo de la farmacia","paragraphs":["Un modelo común puede relacionar ventas con compras, proveedores, existencias y márgenes cuando todas esas fuentes se han conectado y validado.","La conexión operativa de ventas no implica que compras o inventario estén integrados de manera automática."]},{"heading":"Complementar, no sustituir","paragraphs":["Farmetrica no reemplaza a Farmatic: ofrece una capa adicional de análisis comercial sobre los datos autorizados.","El seguimiento de campañas y la exportación para laboratorios constituyen casos específicos de uso de las ventas conectadas."]}],
faq:[["¿Farmetrica sustituye a Farmatic?","No. Complementa la información del software de gestión con una capa de análisis."],["¿Ya se analizan compras y stock de Farmatic?","La fuente validada actualmente es de ventas. El resto requiere integración y verificación."],["¿Funciona con cualquier instalación?","Cada versión y sistema debe comprobarse técnicamente antes de ofrecer la conexión."]],
related:["/integraciones/","/soluciones/ventas-farmacia/","/soluciones/business-intelligence-farmacias/"]
},
{
slug:"nixfarma",category:"Ecosistema ERP",title:"Nixfarma y Farmetrica: analítica para tu farmacia",
description:"Descubre cómo analizar ventas, compras, stock, proveedores y promociones con un modelo de datos independiente para farmacias que trabajan con Nixfarma.",
hero:"Tus datos de Nixfarma pueden contar una historia comercial más completa.",
lead:"Nixfarma resuelve el día a día operativo de muchas oficinas de farmacia. Farmetrica está diseñada para complementar al programa de gestión con análisis de ventas, compras, stock y rentabilidad, utilizando un modelo independiente del origen.",
value:"Un criterio de análisis común, con conexión validada para cada instalación.",
sections:[
{heading:"Más preguntas, una sola visión de negocio",paragraphs:["Ventas, compras, existencias y artículos ganan valor cuando se pueden analizar conjuntamente. El objetivo es entender qué referencias funcionan, qué costes se pueden revisar y dónde se concentra el stock.","Farmetrica ofrece módulos comerciales para estas preguntas, con disponibilidad de datos según la integración que se configure para cada cliente."],points:["Ventas y rendimiento de productos.","Compras y proveedores.","Stock y cobertura.","Rentabilidad y promociones."]},
{heading:"Tus datos conservan su contexto",paragraphs:["Para construir indicadores comparables hay que revisar códigos de producto, fechas, devoluciones, costes y pertenencia a cada farmacia.","Una conexión con Nixfarma exige comprobar la versión y la vía de acceso autorizada. No debe confundirse la existencia del programa con una integración ya desplegada de Farmetrica."]},
{heading:"Pensado para una farmacia y redes",paragraphs:["Una vez disponible un origen validado, los mismos indicadores permiten analizar un punto de venta o consolidar varias farmacias, con filtros y ámbitos por usuario.","La implantación concreta debe definir qué información se proporciona, con qué frecuencia y con qué permisos."]}
],
faq:[["¿Nixfarma es un programa de gestión real?","Sí, Nixfarma es un programa comercial de gestión de farmacias."],["¿Existe ya un conector de Farmetrica validado con Nixfarma?","No consta una integración operativa validada; hay que revisar la instalación y los accesos disponibles."],["¿Farmetrica sustituye a Nixfarma?","No. El enfoque de Farmetrica es añadir análisis comercial a los datos del programa de farmacia."]],
related:["/integraciones/","/soluciones/ventas-farmacia/","/soluciones/control-stock-farmacia/"]
},
{
slug:"unycop",category:"Ecosistema ERP",title:"Unycop y Farmetrica: análisis comercial de farmacia",
description:"Conoce las posibilidades de analítica de ventas, compras, stock y objetivos comerciales para una farmacia que utiliza el programa Unycop.",
hero:"Tu sistema Unycop gestiona operaciones. Tus decisiones necesitan perspectiva.",
lead:"Farmetrica organiza la inteligencia comercial del negocio en torno a ventas, compras, artículos, existencias y promociones. Esta lógica permite trabajar con distintos sistemas de origen, previa adaptación y validación de la conexión.",
value:"Analítica independiente del ERP, con conectividad sujeta a la instalación.",
sections:[
{heading:"Unificar información comercial",paragraphs:["El responsable necesita relacionar qué vende, qué compra, qué margen estimado obtiene y qué stock mantiene. Estas preguntas no dependen de la marca del ERP, sino de disponer de datos coherentes.","El modelo de Farmetrica permite relacionar estas dimensiones por referencia, proveedor, farmacia y periodo, siempre que estén disponibles las fuentes necesarias."],points:["Visión comercial de ventas y compras.","Rendimiento de artículos y familias.","Cobertura y existencias.","Objetivos y campañas por farmacia."]},
{heading:"Una conexión que respete tu sistema",paragraphs:["Unycop cuenta con distintas soluciones y versiones. La disponibilidad de los datos y sus mecanismos de acceso puede cambiar según el producto y la instalación.","Antes de dar por activa la integración hay que validar extracción, permisos, identificadores y reglas de negocio con el propietario autorizado de los datos."]},
{heading:"De un punto de venta a la red",paragraphs:["La comparación entre farmacias cobra valor si los movimientos se interpretan de la misma forma, incluso cuando los orígenes son diferentes.","Farmetrica incorpora una estructura de clientes, farmacias, módulos y roles para organizar el análisis comercial de la red."]}
],
faq:[["¿Unycop es un ERP de farmacia?","Sí, Unycop es una familia comercial de software de gestión para farmacias."],["¿Farmetrica está conectada hoy a Unycop?","No consta una implantación con Unycop verificada. La conexión debe evaluarse y configurarse por instalación."],["¿El programa funciona igual con todas las versiones?","No se puede garantizar; la versión concreta y sus opciones técnicas condicionan la integración."]],
related:["/integraciones/","/soluciones/grupos-de-farmacias/","/soluciones/analisis-compras-farmacia/"]
}
];

export const articles=[
{
slug:"indicadores-promociones-farmacia",category:"Análisis comercial",title:"5 KPIs para evaluar promociones en una farmacia",
description:"Indicadores prácticos para medir una promoción de farmacia: unidades, objetivo, cumplimiento y diferencias por farmacia sin confundir avance con rentabilidad.",
hero:"Qué medir para saber si una promoción está funcionando.",
lead:"Una buena promoción no se evalúa solo porque haya vendido más unidades. Hay que entender qué se esperaba, dónde se vendió y si el periodo es comparable. Estos cinco indicadores ayudan a empezar.",
value:"La cifra útil es la que permite tomar la siguiente decisión.",
sections:[
{heading:"1. Unidades netas vendidas",paragraphs:["El número de unidades es la base del seguimiento. Conviene fijar si se descuentan devoluciones y anulaciones, y aplicar ese criterio de forma homogénea.","Una comparación de periodos con reglas distintas puede crear conclusiones engañosas incluso cuando todos los cálculos son correctos."]},
{heading:"2. Objetivo previsto y 3. porcentaje de cumplimiento",paragraphs:["El objetivo recoge el resultado esperado para una farmacia y un periodo concretos. El porcentaje de cumplimiento relaciona unidades vendidas con esa meta; por ejemplo, 12 unidades frente a 15 equivalen al 80 %.","No es lo mismo alcanzar el 80 % el segundo día de una campaña que el último. La fecha de corte debe acompañar al dato."]},
{heading:"4. Farmacias que requieren revisión",paragraphs:["Una red puede tener buenos números agregados y, al mismo tiempo, una distribución desequilibrada. Comparar cada farmacia con su propia meta permite reconocer esos casos sin penalizar automáticamente a los puntos de venta más pequeños.","La comparación debe tener en cuenta volumen, duración, surtido y participación real de la farmacia."]},
{heading:"5. Calidad de la información",paragraphs:["¿Se conocen exactamente los CNs incluidos? ¿Hay tickets de origen o se usa una estimación? ¿Han cambiado las fechas? Sin respuestas, ningún gráfico ofrece una lectura fiable.","Y una advertencia importante: cumplimiento comercial no es rentabilidad. Para medir margen o beneficio también se necesitan costes, descuentos pactados y otras condiciones económicas."]}
],
faq:[["¿Qué KPI debería revisar primero?","Comienza por unidades vendidas y cumplimiento del objetivo, desglosados por farmacia y periodo."],["¿Un cumplimiento del 100 % demuestra que la promoción fue rentable?","No. La rentabilidad requiere costes y condiciones económicas adicionales."]],
related:["/soluciones/cuadro-mando-farmacias/","/soluciones/seguimiento-ventas-farmacia/","/blog/errores-al-definir-objetivos/"]
},
{
slug:"errores-al-definir-objetivos",category:"Planificación",title:"Errores frecuentes al definir objetivos de promociones por farmacia",
description:"Cómo evitar objetivos mal asignados, CN incorrectos, duplicidades y hojas Excel ambiguas al planificar promociones en grupos de farmacias.",
hero:"Antes de medir una campaña, asegúrate de que la meta tiene sentido.",
lead:"La calidad de un seguimiento depende de cómo se definió el objetivo. Muchos errores aparecen antes de la primera venta: campañas parecidas, referencias incompletas o metas globales sin reparto.",
value:"Corregir la planificación evita discusiones después.",
sections:[
{heading:"Objetivo único para farmacias diferentes",paragraphs:["Dos establecimientos pueden tener volúmenes y perfiles comerciales distintos. Dividir el objetivo total a partes iguales es cómodo, pero no necesariamente adecuado.","Es preferible fijar metas por farmacia con algún criterio explícito, revisable a lo largo de la campaña si cambian sus condiciones."]},
{heading:"Confundir vacío con cero",paragraphs:["Una celda de objetivo vacía suele significar que no se ha asignado una meta, no que la farmacia tenga previsto vender cero unidades. Convertir automáticamente todos los vacíos en ceros deforma los indicadores.","El dato debe conservar su significado en la importación y mostrarse de forma comprensible."]},
{heading:"Asignar el objetivo a la promoción equivocada",paragraphs:["Laboratorio, gama y oferta deben revisarse juntos. Un nombre muy parecido puede representar una condición comercial distinta, especialmente cuando un mismo fabricante ejecuta varias campañas.","Una conciliación segura identifica candidatos ambiguos en lugar de elegir silenciosamente el primero."]},
{heading:"Mezclar ventas del archivo con ventas del sistema",paragraphs:["Algunos Excel combinan objetivos con un avance manual. Si Farmetrica dispone de tickets reales procedentes de un sistema conectado, estos deben ser la referencia para el seguimiento.","Una rutina de revisión mensual del archivo de campañas, sus CNs y fechas previene desviaciones difíciles de rastrear más adelante."]}
],
faq:[["¿Debo rellenar con cero los objetivos vacíos?","No de forma automática. Una ausencia de objetivo y un objetivo igual a cero son situaciones diferentes."],["¿Conviene importar el Excel más de una vez?","Puede ser útil actualizar metas, pero siempre conciliando campañas y conservando la información que no corresponde modificar."]],
related:["/soluciones/objetivos-venta-farmacias/","/soluciones/importar-campanas-excel/","/blog/indicadores-promociones-farmacia/"]
},
{
slug:"como-preparar-informe-laboratorio",category:"Guías prácticas",title:"Cómo preparar un informe de ventas para un laboratorio farmacéutico",
description:"Qué datos incluir en un Excel de ventas de promociones para laboratorios, cómo organizarlo por campaña y qué revisar antes de compartirlo.",
hero:"Un informe útil es el que se puede revisar y explicar.",
lead:"El laboratorio no siempre necesita una presentación extensa. A menudo necesita un archivo consistente que identifique las ventas relacionadas con una campaña, su periodo y los productos incluidos.",
value:"Preparar menos archivos, pero más claros.",
sections:[
{heading:"Empieza por la definición exacta de la promoción",paragraphs:["Identifica laboratorio, nombre de la campaña, fechas de vigencia y códigos nacionales incluidos. Si una referencia aparece en varias acciones, revisa si existe solapamiento antes de consolidar las cifras.","También conviene comprobar qué farmacias participaron y qué reglas de devoluciones o anulaciones se aplican a las unidades."]},
{heading:"Columnas que facilitan la conciliación",paragraphs:["La información de origen puede incluir farmacia, documento de venta, fecha y hora, código nacional, descripción, unidades y diferentes importes de línea.","El dato necesario depende de lo acordado con el laboratorio. Evita enviar datos personales o campos innecesarios; revisa los permisos y el tratamiento apropiado de cada archivo."]},
{heading:"Un Excel por campaña o varios en un ZIP",paragraphs:["Separar campañas evita confundir periodos y productos. Farmetrica permite exportar un Excel para una promoción y, si se seleccionan varias, reunir los archivos independientes en un ZIP.","Antes de compartir, compara el número total de líneas con el origen, comprueba el periodo y confirma que no se ha truncado la descarga por un límite de páginas."]},
{heading:"Distingue objetivo de resultado",paragraphs:["El objetivo pactado sirve para interpretar el avance de la campaña. Las líneas de venta son el soporte de las operaciones. Mezclarlos en una misma columna dificulta la revisión y puede alterar la lectura del informe.","La trazabilidad se gana con reglas sencillas y aplicadas de la misma forma a cada promoción."]}
],
faq:[["¿Es mejor crear un Excel único para todas las campañas?","Normalmente ayuda mantener un archivo por promoción. Para facilitar el envío, pueden agruparse varios Excel en un ZIP."],["¿Basta con enviar el total de unidades?","Depende de lo acordado, pero el detalle de ventas permite contrastar mejor los resultados."]],
related:["/soluciones/reporting-laboratorios/","/soluciones/gestion-promociones-farmacia/","/blog/indicadores-promociones-farmacia/"]
},
{
slug:"codigos-nacionales-en-promociones",category:"Producto y datos",title:"Por qué el CN es importante para controlar promociones de farmacia",
description:"Cómo usar códigos nacionales (CN) para identificar productos de una campaña farmacéutica y cruzarlos correctamente con las ventas de origen.",
hero:"La promoción necesita nombres. El seguimiento necesita referencias precisas.",
lead:"El nombre comercial de una gama puede cambiar según el documento. El código nacional ayuda a identificar los artículos incluidos sin depender de descripciones aproximadas.",
value:"Menos ambigüedad al cruzar promociones y ventas.",
sections:[
{heading:"Qué representa un código nacional en la campaña",paragraphs:["El CN permite relacionar un producto concreto con los registros comerciales y es especialmente útil cuando hay tamaños, presentaciones o variantes dentro de una misma gama. En España es un identificador habitual; fuera de este mercado pueden emplearse códigos de barras u otras referencias normalizadas.","En los datos de importación de Farmetrica, los códigos se manejan en el formato de seis dígitos utilizado por el sistema, preservando ceros iniciales cuando corresponde."]},
{heading:"Nombres de promoción y CN cumplen tareas distintas",paragraphs:["Una campaña se comunica con un nombre comprensible para el equipo, como «Higiene bucal 3x2». La venta registrada, en cambio, necesita saber qué referencias participaron exactamente.","Si el listado de CNs está incompleto, el seguimiento puede omitir unidades legítimas. Si incluye productos ajenos a la oferta, puede sobrestimar su rendimiento."]},
{heading:"Buenas prácticas de importación",paragraphs:["Conviene comprobar los códigos antes de lanzar la promoción y revisar qué sucede con referencias nuevas o descatalogadas.","Al importar desde Excel, la validación de CNs, la oferta y el periodo deben conservarse juntos. Esto facilita conciliar campañas similares y evita usar una descripción como único identificador."]},
{heading:"De la referencia al ticket de venta",paragraphs:["Con una fuente de datos conectada, el sistema puede contrastar las líneas de venta de los CNs participantes en un intervalo de fechas. El resultado gana valor cuando también se vincula a la farmacia de origen.","Esta lectura no debe confundirse con un análisis de receta electrónica o información clínica; el propósito descrito es exclusivamente comercial."]}
],
faq:[["¿Puedo usar varios CNs en una campaña?","Sí. Una promoción puede incluir diferentes referencias y gamas."],["¿Es suficiente filtrar por nombre de producto?","No siempre: nombres y descripciones varían. Un código validado ofrece una referencia comercial más precisa."]],
related:["/soluciones/gestion-promociones-farmacia/","/soluciones/importar-campanas-excel/","/soluciones/seguimiento-ventas-farmacia/"]
}
];


// Arquitectura editorial ampliada: las distintas funciones son áreas del producto,
// y cada fuente ERP se valida por separado antes de afirmar una conexión operativa.
solutions.push(
{
slug:"ventas-farmacia",category:"Análisis de ventas",title:"Software de análisis de ventas para farmacias",
description:"Analiza ventas de farmacia por artículo, periodo y punto de venta. Evolución comercial, unidades y rendimiento del surtido en Farmetrica.",
hero:"No te conformes con saber cuánto vendes. Entiende qué mueve tus ventas.",
lead:"Las ventas cuentan una historia distinta cuando las analizas por periodo, producto y farmacia. Farmetrica organiza esa información para que detectes tendencias, cambios en el surtido y oportunidades comerciales sin perderte entre informes.",
value:"De la facturación a las decisiones de cada día.",
sections:[
{heading:"Conoce cómo evoluciona tu actividad comercial",paragraphs:["Revisa las unidades y el valor de las ventas por periodos, identifica qué referencias concentran la demanda y descubre dónde merece la pena profundizar.","Una visión agregada sirve para orientarse; el verdadero valor llega al bajar a cada producto, familia y farmacia y comparar periodos equivalentes."],points:["Evolución de ventas por periodo.","Análisis por artículo y familia.","Desglose por farmacia y ámbito autorizado.","Filtros y consultas detalladas."]},
{heading:"Ve más allá de los productos que más se venden",paragraphs:["Un artículo con grandes unidades puede aportar un resultado económico muy diferente a otro con menor rotación. Por eso el análisis de ventas tiene más sentido cuando se relaciona con compras, costes y existencias.","Farmetrica reúne esas dimensiones en un modelo común de información comercial para ayudarte a formular mejores preguntas." ]},
{heading:"Una farmacia o toda la red",paragraphs:["Cada farmacia tiene su propia demanda, surtido y ritmo. Analizarlas juntas y por separado permite detectar diferencias útiles sin convertir cada revisión en un nuevo Excel.","Las ventas registradas necesitan una fuente conectada y autorizada. En la implantación actual existe una conexión operativa con datos de Farmatic; la cobertura de otros sistemas se revisa caso por caso."]}
],
faq:[["¿Puedo analizar las ventas de varios puntos de venta?","La plataforma contempla filtros y ámbitos de farmacia, con vistas individuales y de red según los permisos de cada usuario."],["¿Qué diferencia hay entre ventas y rentabilidad?","Ventas describe la actividad comercial; rentabilidad requiere relacionar los ingresos con costes y criterios de margen adecuados."]],
related:["/soluciones/rendimiento-articulos-farmacia/","/soluciones/rentabilidad-farmacia/","/soluciones/cuadro-mando-farmacias/"]
},
{
slug:"analisis-compras-farmacia",category:"Compras",title:"Análisis de compras y coste de adquisición en farmacias",
description:"Controla compras, PUC y precios de proveedores de farmacia. Compara artículos y detecta desviaciones de coste y oportunidades de negociación.",
hero:"Compra con información. No solo con costumbre.",
lead:"Lo que pagas por cada artículo influye directamente en el margen que puedes conseguir. Cuando se integran y validan las compras, Farmetrica permite poner proveedores y costes unitarios en perspectiva.",
value:"Cada diferencia de coste merece una segunda mirada.",
sections:[
{heading:"Compara lo que compras y cuánto pagas",paragraphs:["Organiza compras por proveedor, farmacia, artículo y periodo; revisa el precio unitario de compra (PUC) y localiza desviaciones que pasan inadvertidas cuando solo se consulta el importe total.","Trabajar a nivel de referencia ayuda a distinguir un cambio real de precio de una variación en el volumen o el surtido."],points:["Importe comprado por periodo y proveedor.","PUC por artículo.","Comparación de costes entre referencias.","Oportunidades de mejora en compras."]},
{heading:"Negociar mejor empieza por medir mejor",paragraphs:["Una negociación es más sólida cuando conoces el volumen adquirido, los proveedores que concentran la compra y qué artículos muestran diferencias de coste.","Los indicadores de potencial deben interpretarse con cautela: condiciones, rappels, disponibilidad, plazos e impuestos también forman parte de la decisión."]},
{heading:"Relaciona las compras con lo que ocurre después",paragraphs:["Comprar barato no siempre significa comprar bien. Si el producto permanece inmovilizado, el coste financiero del stock también importa.","Por eso Farmetrica conecta el análisis de compras con stock, rotación, reposición y rendimiento comercial."]}
],faq:[["¿Qué es el PUC?","Es el precio unitario de compra. Su interpretación concreta depende de cómo se registren descuentos, impuestos y bonificaciones."],["¿Puedo comparar compras entre farmacias?","La estructura del producto permite analizar información por farmacia y consolidada cuando los datos se encuentran disponibles."]],
related:["/soluciones/analisis-proveedores-farmacia/","/soluciones/comparativa-genericos-farmacia/","/soluciones/rentabilidad-farmacia/"]
},
{
slug:"rentabilidad-farmacia",category:"Rentabilidad",title:"Rentabilidad y márgenes de farmacia por artículo",
description:"Comprende márgenes estimados, ventas, compras y contribución de artículos para mejorar la rentabilidad de farmacia con decisiones fundamentadas.",
hero:"Facturar más no siempre significa ganar más.",
lead:"El margen cambia según los precios de compra, las referencias vendidas y la composición del surtido. Farmetrica te ayuda a entender qué impulsa el resultado de tu negocio y qué decisiones merece la pena revisar.",
value:"Más claridad sobre dónde se crea valor.",
sections:[
{heading:"Del volumen a la contribución",paragraphs:["Analizar solo facturación es quedarse a medias. Una referencia de alta venta puede presentar un margen unitario reducido; otra con menor demanda puede aportar una contribución más favorable.","Relaciona ingresos y costes de adquisición con criterios consistentes, y distingue los márgenes estimados de un beneficio contable completo."],points:["Margen bruto estimado y porcentaje.","Rentabilidad por artículo y familia.","Comparación entre centros o periodos.","Análisis combinado con compras y rotación."]},
{heading:"El surtido y el inventario también afectan a la rentabilidad",paragraphs:["El capital atrapado en exceso de stock, los productos sin rotación y las necesidades de reposición condicionan la eficiencia del negocio.","Cuando dispone de stock, ventas y costes validados, la plataforma ayuda a cruzarlos para identificar oportunidades de mejora en el surtido."]},
{heading:"Decisiones explicables",paragraphs:["Los márgenes fiables dependen de costes netos bien registrados, reglas de descuentos e impuestos y devoluciones. Farmetrica muestra la lógica comercial sobre los datos disponibles, sin convertir una estimación en una garantía.","La oportunidad real se valida con los datos y las condiciones de cada farmacia."]}
],faq:[["¿Farmetrica calcula el beneficio neto contable?","El análisis de rentabilidad comercial y márgenes estimados no sustituye una cuenta de resultados contable completa."],["¿Puedo analizar la rentabilidad por producto?","Sí, el modelo relaciona artículos, ventas y compras cuando el origen incluye los costes necesarios."]],
related:["/soluciones/rendimiento-articulos-farmacia/","/soluciones/analisis-compras-farmacia/","/soluciones/control-stock-farmacia/"]
},
{
slug:"control-stock-farmacia",category:"Stock e inventario",title:"Control de stock, cobertura y rotación en farmacias",
description:"Identifica stock de baja rotación, existencias excesivas y cobertura estimada por farmacia y artículo. Analiza capital inmovilizado con Farmetrica.",
hero:"Que el stock trabaje para ti. No al revés.",
lead:"Cada artículo que no rota representa espacio y recursos inmovilizados. Cada referencia que falta puede significar una venta que no llega. Farmetrica reúne stock, ventas y compras para ayudarte a encontrar el equilibrio.",
value:"Inventario visible. Capital mejor orientado.",
sections:[
{heading:"Qué tienes y cómo se mueve",paragraphs:["Organiza existencias por farmacia y referencia de producto; compara unidades disponibles con el ritmo de venta del periodo y la cobertura estimada.","Distinguir referencias de rotación saludable, productos sin salida y situaciones de sobrestock es el punto de partida para una revisión inteligente."],points:["Unidades y valoración de existencias.","Cobertura estimada en días.","Referencias con baja o nula rotación.","Exceso de stock y alertas de revisión."]},
{heading:"Reduce decisiones basadas en intuición",paragraphs:["No todas las farmacias demandan lo mismo. Una cobertura razonable en un centro puede resultar excesiva en otro.","La comparación por punto de venta ayuda a priorizar qué familias, referencias y compras necesitan seguimiento." ]},
{heading:"Conecta inventario con reposición y compra",paragraphs:["Reponer no consiste solo en cubrir el stock mínimo: también intervienen ventas recientes, estacionalidad, disponibilidad y coste.","Los indicadores de Farmetrica permiten estudiar estas dimensiones cuando la fuente de datos ofrece las existencias y movimientos necesarios."]}
],faq:[["¿Puede identificar artículos sin ventas?","El módulo contempla indicadores de baja o nula rotación a partir de existencias y ventas disponibles."],["¿Los datos de stock se actualizan automáticamente en todos los ERP?","La actualización depende del conector y la fuente concreta habilitada; no existe una conexión universal validada."]],
related:["/soluciones/reposicion-stock-farmacia/","/soluciones/analisis-compras-farmacia/","/blog/stock-inmovilizado-farmacia/"]
},
{
slug:"reposicion-stock-farmacia",category:"Reposición",title:"Análisis de reposición y necesidades de pedido en farmacias",
description:"Relaciona ventas, existencias y necesidades de pedido de cada farmacia. Optimiza la reposición para equilibrar disponibilidad y capital inmovilizado.",
hero:"Ni roturas que cuestan ventas, ni exceso que inmoviliza dinero.",
lead:"La reposición gana precisión cuando considera el ritmo comercial y el inventario real. Farmetrica pone las necesidades de pedido en contexto para revisar dónde faltan unidades y dónde sobran.",
value:"Más previsión. Menos decisiones a ciegas.",
sections:[
{heading:"Detecta las necesidades de reposición",paragraphs:["El análisis cruza referencias, farmacias, unidades en stock y patrones de venta para estimar necesidades de reposición.","Un cálculo de necesidad es apoyo a la decisión, no sustituye las reglas de proveedor, los plazos de entrega ni la revisión profesional del responsable."],points:["Stock actual por referencia.","Necesidad estimada de reposición.","Coste aproximado de pedido.","Filtros por farmacia, producto y periodo."]},
{heading:"Las prioridades cambian según la farmacia",paragraphs:["La demanda de un producto puede variar enormemente entre barrios y establecimientos. El análisis individual evita tratar toda la red como un único almacén.","Una visión conjunta ayuda a detectar diferencias que merecen una revisión de surtido o aprovisionamiento."]},
{heading:"Reponer mejor empieza por conocer el stock",paragraphs:["Los datos de reposición cobran sentido al relacionarlos con la cobertura, la rotación, los costes y las compras efectivas.","Así se reducen los cambios de criterio entre hojas de cálculo y se facilita la conversación con los responsables de cada punto de venta."]}
],faq:[["¿Genera pedidos automáticamente al proveedor?","La funcionalidad descrita es de análisis de necesidades; una automatización de pedido depende de la integración y configuración del sistema de origen."],["¿Puedo comparar necesidades entre farmacias?","Sí, el modelo común permite desglosar indicadores por farmacia cuando se dispone de sus datos."]],
related:["/soluciones/control-stock-farmacia/","/soluciones/analisis-proveedores-farmacia/","/blog/stock-inmovilizado-farmacia/"]
},
{
slug:"analisis-proveedores-farmacia",category:"Proveedores",title:"Análisis de proveedores y concentración de compras en farmacia",
description:"Analiza proveedores de farmacia, importes de compra, artículos y diferencias de coste. Mejora la negociación a partir de información contrastable.",
hero:"Conoce a tus proveedores más allá de la factura.",
lead:"Saber cuánto compras a cada proveedor es solo el principio. Farmetrica te ayuda a revisar el surtido adquirido, el coste por referencia, la concentración del gasto y las oportunidades de comparación.",
value:"Una relación comercial más inteligente.",
sections:[
{heading:"Quién suministra qué, dónde y a qué coste",paragraphs:["La plataforma organiza la actividad de proveedores en relación con productos y compras para ayudar a identificar dependencias, categorías y niveles de gasto.","El maestro de proveedores ofrece una estructura común para trabajar de forma coherente entre varios puntos de venta."],points:["Volumen de compra por proveedor.","Artículos asociados.","Distribución del gasto.","Potencial de revisión de precios."]},
{heading:"Compara alternativas con criterio",paragraphs:["No siempre conviene cambiar por el menor PUC. Disponibilidad, plazo, condiciones comerciales y fiabilidad del suministro pueden pesar tanto como el precio.","El análisis facilita localizar qué referencias revisar primero y preparar negociaciones con información consistente."]},
{heading:"Una lectura para cada responsable",paragraphs:["El responsable local necesita conocer su compra; una dirección de grupo busca también concentración y oportunidades entre farmacias.","Farmetrica trabaja con ámbitos de datos por cliente, farmacia y usuario para organizar estas perspectivas."]}
],faq:[["¿Permite ver el gasto por proveedor?","Sí, es uno de los indicadores del módulo de compras y proveedores."],["¿El software realiza negociaciones automáticamente?","No. Los informes ayudan a preparar y evaluar decisiones comerciales."]],
related:["/soluciones/analisis-compras-farmacia/","/soluciones/comparativa-genericos-farmacia/","/blog/compras-inteligentes-farmacia/"]
},
{
slug:"comparativa-genericos-farmacia",category:"Genéricos",title:"Comparativa de medicamentos genéricos y costes de compra",
description:"Compara compras de medicamentos genéricos por grupo, referencia y proveedor para detectar diferencias de PUC y oportunidades de optimización.",
hero:"En genéricos, pequeñas diferencias pueden merecer grandes decisiones.",
lead:"Entre alternativas de un mismo grupo, el precio de adquisición, el proveedor y el histórico de compra importan. Farmetrica ayuda a encontrar diferencias y cuantificar oportunidades de revisión.",
value:"Comparativas útiles para comprar con criterio.",
sections:[
{heading:"Compara grupos y referencias",paragraphs:["Organiza artículos marcados como genéricos por grupo, referencia y proveedor, y revisa costes unitarios de adquisición.","La comparabilidad depende de una clasificación correcta de presentaciones y grupos: no deben tratarse como equivalentes referencias que no lo son."],points:["Compra de genéricos por periodo.","Comparación de PUC.","Análisis por proveedor y grupo.","Potencial económico de revisión."]},
{heading:"Decide considerando las condiciones reales",paragraphs:["Un precio menor por unidad puede resultar atractivo, pero también hay que valorar el suministro, disponibilidad, requisitos regulatorios y condiciones pactadas.","Los importes de potencial son estimaciones basadas en los datos y reglas del análisis, no ahorros garantizados."]},
{heading:"Prioriza donde el volumen importa",paragraphs:["Un cambio pequeño en una referencia de alta rotación puede tener impacto comercial relevante. Pero esa oportunidad solo es visible cuando precio y volumen se analizan juntos.","Farmetrica reúne los datos necesarios para construir una comparativa útil de compras y productos."]}
],faq:[["¿La plataforma decide qué genérico dispensar?","No. El módulo es de análisis comercial de compras, no de decisión clínica ni de sustitución terapéutica."],["¿Necesita datos de proveedores?","Sí, para comparar costes reales es necesario disponer de precios y proveedores consistentes."]],
related:["/soluciones/analisis-compras-farmacia/","/soluciones/analisis-proveedores-farmacia/","/blog/estrategia-genericos-farmacia/"]
},
{
slug:"rendimiento-articulos-farmacia",category:"Artículos",title:"Rendimiento de artículos y categorías en farmacias",
description:"Descubre qué artículos y familias impulsan ventas, unidades y rentabilidad. Analiza el rendimiento por producto y farmacia con Farmetrica.",
hero:"Cada referencia tiene una historia. Y un resultado.",
lead:"Detrás del total de ventas hay referencias de alta rotación, productos que apenas se mueven y familias con comportamientos distintos. Farmetrica conecta ese detalle con compras y existencias.",
value:"El surtido deja de ser una lista para convertirse en una decisión.",
sections:[
{heading:"Entiende el rendimiento de cada artículo",paragraphs:["Consulta referencias por su identificador de origen, descripción o familia, y revisa unidades, facturación y evolución de su venta.","Cruzar esos datos con costes de adquisición ayuda a pasar del ranking de ventas a una evaluación económica del surtido."],points:["Unidades y valor vendidos.","Rendimiento por artículo y familia.","Relación con coste y margen estimado.","Comparación por farmacia y periodo."]},
{heading:"Encuentra referencias que necesitan atención",paragraphs:["No todo lo que se vende poco debe retirarse, ni todo lo que se vende mucho debe reforzarse sin análisis. La cobertura, la contribución y la demanda pueden cambiar la conclusión.","Un buen informe ayuda a detectar los candidatos a revisar y deja la decisión al equipo comercial."]},
{heading:"Una vista consistente entre departamentos",paragraphs:["Compras, stock y ventas deben referirse al mismo producto y al mismo periodo. Farmetrica utiliza una estructura común de identificadores para facilitar esa coherencia.","El origen de datos puede utilizar CN, códigos de barras u otros identificadores adaptados a cada país o ERP, siempre con su correspondencia validada."]}
],faq:[["¿Puedo filtrar por CN o categoría?","La plataforma trabaja con referencias y familias de producto, con filtros por valores y búsqueda."],["¿Es una solución para una sola farmacia?","Sí. La misma lógica puede aplicarse a un punto de venta o a varios con acceso autorizado."]],
related:["/soluciones/ventas-farmacia/","/soluciones/rentabilidad-farmacia/","/soluciones/control-stock-farmacia/"]
}
);
integrations.push(
{
slug:"bitfarma",category:"Programas de gestión",title:"Bitfarma y el análisis comercial de Farmetrica",
description:"Cómo se relaciona el software Bitfarma con un modelo independiente de analítica comercial y qué datos hacen falta para conectar ventas, compras y stock.",
hero:"Trabajas con Bitfarma. Tu información comercial puede dar mucho más.",
lead:"Bitfarma es un programa de gestión para oficinas de farmacia. Farmetrica utiliza un modelo de datos independiente del ERP para que las preguntas comerciales sigan siendo las mismas, cualquiera que sea el sistema de origen.",
value:"Conexión a Bitfarma sujeta a comprobación de acceso, esquema y permisos.",
sections:[
{heading:"Una fuente de datos, muchas decisiones",paragraphs:["Para construir paneles de ventas, artículos, compras, stock y rentabilidad hacen falta movimientos e identificadores consistentes.","La viabilidad de la conexión depende de la instalación y de las vías autorizadas para disponer de los datos." ]},
{heading:"Analiza con el mismo criterio",paragraphs:["El objetivo es mantener la misma lectura de ventas, costes y existencias, adaptando los identificadores y formatos de origen.","Farmetrica no se anuncia como conector oficial ni como integración automática con cualquier versión de Bitfarma."]},
{heading:"Qué validar en la implantación",paragraphs:["El sistema de origen, permisos, frecuencia de actualización, anulaciones y correspondencias de referencias se revisan antes de habilitar un informe operativo.","Sin esa validación, una integración no puede considerarse implantada."]}
],faq:[["¿Está conectado Bitfarma actualmente?","No consta una conexión operativa verificada de Farmetrica con Bitfarma. Cada instalación requiere validación técnica."],["¿Bitfarma es un software real?","Sí, Bitfarma es un software comercial de gestión de farmacias; se menciona con fines descriptivos."]],
related:["/integraciones/","/soluciones/ventas-farmacia/","/soluciones/control-stock-farmacia/"]
},
{
slug:"farmanager",category:"Programas de gestión",title:"Farmanager de Cofares y analítica comercial para farmacias",
description:"Farmanager, el software de farmacia desarrollado por Cofares, y los requisitos para relacionar su información comercial con Farmetrica.",
hero:"Farmanager y una visión comercial de toda la farmacia.",
lead:"Farmanager es un programa de farmacia desarrollado por Cofares. Farmetrica plantea un modelo de análisis común para relacionar ventas, compras, proveedores y stock, con independencia del ERP de origen.",
value:"Una conexión con Farmanager exige evaluación técnica y autorización de cada instalación.",
sections:[
{heading:"El valor no está en duplicar tu ERP",paragraphs:["Un buen sistema de gestión resuelve operaciones diarias; una herramienta analítica ayuda a revisar decisiones comerciales con una visión transversal.","Analizar compras, márgenes o inventario requiere disponer de datos correctos, homologados y actualizados." ]},
{heading:"Qué información es imprescindible",paragraphs:["Se necesitan referencias identificables, ventas y compras con fechas, costes coherentes y existencias por farmacia.","La disponibilidad de estos datos y sus métodos de acceso deben verificarse con las partes autorizadas."]},
{heading:"Unificar preguntas entre farmacias",paragraphs:["Una red puede utilizar distintos sistemas, pero necesitar los mismos indicadores para cada establecimiento.","La correspondencia entre códigos, reglas y movimientos es parte esencial de una conexión fiable."]}
],faq:[["¿Existe una conexión activa con Farmanager?","No consta una integración activa y validada de Farmetrica con Farmanager."],["¿Farmanager pertenece a Cofares?","Sí, Cofares identifica Farmanager como su solución tecnológica de gestión de farmacia."]],
related:["/integraciones/","/soluciones/analisis-compras-farmacia/","/soluciones/grupos-de-farmacias/"]
}
);
articles.push(
{
slug:"compras-inteligentes-farmacia",category:"Compras y proveedores",title:"Comprar mejor es ganar margen: cómo analizar proveedores y PUC",
description:"Una guía práctica para comparar PUC, volumen de compras y proveedores en farmacia y detectar oportunidades de mejora sin caer en falsas economías.",
hero:"La diferencia entre comprar y comprar bien está en los datos.",
lead:"Negociar con proveedores sin conocer el coste real de cada referencia es avanzar a ciegas. Un análisis de compras bien planteado permite priorizar donde el potencial es mayor.",
value:"Una buena comparativa tiene referencias, fechas y condiciones consistentes.",
sections:[
{heading:"Empieza por el coste unitario",paragraphs:["El precio unitario de compra (PUC) ayuda a comparar referencias adquiridas en distintos periodos y a distintos proveedores. Sin embargo, hay que aclarar si incorpora descuentos, bonificaciones e impuestos.","Una misma referencia no debe aparecer con costes aparentemente distintos solo porque los cálculos utilizan criterios diferentes."]},
{heading:"Cruza precio con volumen",paragraphs:["Ahorrar unos céntimos en un artículo de alta rotación puede ser más relevante que reducir varios euros en un producto de movimiento excepcional.","La combinación de PUC, unidades compradas y valor de compra permite dirigir las negociaciones hacia oportunidades tangibles."]},
{heading:"No olvides el inventario",paragraphs:["Comprar al mejor precio pierde parte de su valor si la mercancía permanece meses en la estantería.","Cruzar compras con ventas y stock evita analizar el precio de adquisición de forma aislada y da contexto a la decisión."]}
],faq:[["¿Un menor PUC garantiza ahorro?","No siempre. También intervienen condiciones de suministro, volumen, bonificaciones y rotación."],["¿Por dónde empiezo?","Por las referencias de mayor volumen y las compras con diferencias de coste verificables."]],
related:["/soluciones/analisis-compras-farmacia/","/soluciones/analisis-proveedores-farmacia/","/soluciones/rentabilidad-farmacia/"]
},
{
slug:"stock-inmovilizado-farmacia",category:"Stock e inventario",title:"Stock inmovilizado: cómo encontrar dinero parado en las estanterías",
description:"Aprende a detectar stock de baja rotación, cobertura excesiva y existencias inmovilizadas en tu farmacia utilizando ventas y stock.",
hero:"Tu estantería puede esconder oportunidades de rentabilidad.",
lead:"Un almacén lleno no garantiza disponibilidad inteligente. A veces significa capital concentrado en productos que tardan demasiado en rotar.",
value:"La cobertura es un indicador; la decisión siempre necesita contexto.",
sections:[
{heading:"Qué significa que un artículo no rote",paragraphs:["Se considera de baja rotación cuando su salida es reducida respecto al periodo que estamos analizando. Es importante distinguir los productos nuevos, estacionales o de servicio de aquellos cuyo exceso es evitable.","Una fotografía aislada del stock resulta insuficiente: hay que mirar el histórico de ventas."]},
{heading:"Relaciona existencias y demanda",paragraphs:["Los días de cobertura estimados ayudan a comparar referencias con necesidades diferentes.","Revisar artículos sin ventas y con unidades disponibles permite priorizar el análisis, pero no sustituye una política de surtido."]},
{heading:"Convierte la detección en un plan",paragraphs:["Antes de volver a comprar una referencia, comprueba su salida reciente, la existencia disponible y las condiciones de pedido.","Farmetrica organiza los datos para que el responsable pueda evaluar exceso de stock y reposición desde una misma vista."]}
],faq:[["¿La cobertura sirve para todos los productos?","Es orientativa y debe interpretarse según estacionalidad, demanda y necesidades de servicio."],["¿Se puede comparar entre farmacias?","Sí, siempre que las cifras de stock y ventas sean consistentes y comparables."]],
related:["/soluciones/control-stock-farmacia/","/soluciones/reposicion-stock-farmacia/","/soluciones/rendimiento-articulos-farmacia/"]
},
{
slug:"rentabilidad-por-articulo",category:"Rentabilidad",title:"Rentabilidad por artículo: las ventas no cuentan toda la historia",
description:"Analiza facturación, PUC, costes de compra y márgenes estimados para entender qué artículos contribuyen más al resultado comercial de una farmacia.",
hero:"Que se venda mucho no significa que aporte más margen.",
lead:"El ranking de artículos por unidades o importe es útil, pero no basta para conocer el rendimiento real del surtido.",
value:"Ventas, costes y rotación explican partes distintas del negocio.",
sections:[
{heading:"Distingue ingreso y margen",paragraphs:["La venta mide la actividad, mientras que el margen relaciona el importe obtenido con el coste de la mercancía.","Una comparativa exige mantener los mismos criterios de impuestos, descuentos y devoluciones para todas las referencias."]},
{heading:"No compares artículos sin contexto",paragraphs:["Las referencias de alta rotación cumplen funciones distintas a los productos de compra ocasional. También hay artículos clave para mantener un surtido de servicio.","Comparar volumen y contribución, en vez de fijarse solo en una cifra, ayuda a tomar decisiones equilibradas."]},
{heading:"Relaciónalo con compras y existencias",paragraphs:["Una buena contribución aparente puede perder atractivo si obliga a mantener demasiado inventario.","La mirada conjunta a compras, ventas y stock ayuda a identificar qué referencias merecen un análisis más detallado."]}
],faq:[["¿Margen bruto significa beneficio neto?","No. El margen bruto no incorpora necesariamente todos los costes operativos, financieros y fiscales de la farmacia."]],
related:["/soluciones/rentabilidad-farmacia/","/soluciones/rendimiento-articulos-farmacia/","/soluciones/analisis-compras-farmacia/"]
},
{
slug:"estrategia-genericos-farmacia",category:"Genéricos",title:"Genéricos: compara costes y detecta oportunidades de compra",
description:"Aprende a comparar compras de genéricos de grupos equivalentes, proveedores y precios unitarios sin perder de vista las condiciones comerciales.",
hero:"En genéricos, la comparativa correcta comienza por referencias correctas.",
lead:"No basta con ver dos precios y elegir el menor. La clasificación del producto, el volumen y las condiciones de suministro determinan si la comparación es realmente útil.",
value:"Un análisis comercial de compras, no una recomendación clínica.",
sections:[
{heading:"Agrupa bien antes de comparar",paragraphs:["Los grupos y presentaciones deben estar correctamente identificados para no presentar como alternativas artículos que no son realmente comparables.","Conviene revisar CN, formato, dosis y los criterios que resulten pertinentes para el análisis comercial."]},
{heading:"Combina precio unitario y volumen",paragraphs:["Un pequeño diferencial de PUC puede representar una oportunidad cuando se concentra en productos de compra frecuente.","La evaluación debe considerar además disponibilidad, acuerdos y continuidad del suministro."]},
{heading:"Prioriza las acciones realistas",paragraphs:["Las estimaciones de mejora ayudan a preparar conversaciones con los proveedores, pero no son ahorros garantizados.","Farmetrica permite estructurar compras, grupos y PUC para identificar casos que merecen una revisión."]}
],faq:[["¿La plataforma decide sustituciones farmacológicas?","No. El análisis se limita a datos comerciales y costes. Las decisiones asistenciales corresponden a los profesionales y normativa aplicable."]],
related:["/soluciones/comparativa-genericos-farmacia/","/soluciones/analisis-compras-farmacia/","/soluciones/analisis-proveedores-farmacia/"]
}
);

// Nuevas búsquedas de intención alta: BI en farmacia y validación de orígenes.
solutions.push({
  "slug": "business-intelligence-farmacias",
  "category": "Business Intelligence",
  "title": "Business intelligence para farmacias: ventas, compras y stock",
  "description": "Business intelligence para farmacias y grupos: conecta ventas, compras, stock, proveedores, rentabilidad y promociones en un análisis comercial común.",
  "hero": "Convierte los datos de tu farmacia en decisiones más claras.",
  "lead": "Las farmacias acumulan datos de ventas, compras, inventario y proveedores. El reto no consiste en crear otro informe: consiste en cruzar esa información para detectar oportunidades y actuar. Farmetrica organiza las métricas comerciales en una misma plataforma, sujeta a la disponibilidad de cada origen.",
  "value": "Una capa de análisis sobre tu software de farmacia, sin sustituirlo.",
  "sections": [
    {
      "heading": "Qué debería ofrecer el BI de una farmacia",
      "paragraphs": [
        "Un cuadro de mando de farmacia debe explicar tanto la actividad como sus causas. La facturación muestra una parte; el coste de adquisición, las existencias y la rotación completan la visión. Los indicadores necesitan un periodo concreto, una farmacia identificada y reglas de cálculo comprensibles.",
        "Farmetrica reúne áreas de ventas, compras, artículos, proveedores, stock, reposición, genéricos, rentabilidad y promociones. Cuando el origen proporciona los datos adecuados, estas áreas permiten pasar de una cifra agregada a las referencias o farmacias que la originan."
      ],
      "points": [
        "Ventas y unidades por artículo y periodo.",
        "Compras, coste unitario y proveedores.",
        "Stock, rotación y cobertura.",
        "Margen estimado cuando existe información suficiente de costes.",
        "Objetivos de promociones por farmacia."
      ]
    },
    {
      "heading": "Preguntas reales que un cuadro de mando puede responder",
      "paragraphs": [
        "¿Qué referencias concentran el valor del stock y apenas se mueven? ¿En qué artículos ha cambiado el precio de compra? ¿Qué productos venden mucho, pero tienen un margen estimado limitado? ¿En qué puntos de venta una campaña está lejos de su objetivo?",
        "Para responder no basta con mezclar tablas. Las unidades, los importes y las devoluciones deben interpretarse de la misma manera, y es necesario saber cuándo se han actualizado los movimientos del programa de gestión."
      ],
      "points": [
        "Identificar artículos que requieren revisar su stock.",
        "Localizar diferencias de coste de compra en referencias comparables.",
        "Seguir campañas y objetivos sin repetir informes manuales."
      ]
    },
    {
      "heading": "BI para una farmacia o para un grupo",
      "paragraphs": [
        "Una sola farmacia busca tomar decisiones sobre su surtido, sus proveedores y su actividad diaria. Un grupo, además, necesita comparar centros y consolidar criterios sin perder la identidad de cada negocio.",
        "El diseño multiempresa de Farmetrica contempla clientes, farmacias y permisos. La disponibilidad concreta de módulos y datos se configura por implantación; no se presume acceso universal a todas las fuentes."
      ]
    },
    {
      "heading": "No todos los programas ofrecen la misma conexión",
      "paragraphs": [
        "El modelo de negocio puede ser independiente del ERP, pero la extracción no lo es. Hay que comprobar la versión instalada, permisos, campos disponibles, identificadores de producto, devoluciones y frecuencia de sincronización.",
        "Existe una conexión operativa en un entorno Farmatic para datos de ventas. En Nixfarma, Unycop y otros sistemas no debe darse por hecho un conector probado: se requiere análisis técnico antes de presentar una integración como operativa."
      ]
    }
  ],
  "faq": [
    [
      "¿Farmetrica sustituye a mi programa de gestión?",
      "No. Es una capa de análisis complementaria. La operativa de la farmacia permanece en el software de origen."
    ],
    [
      "¿Puedo comparar varias farmacias?",
      "La plataforma contempla la gestión de varias farmacias y la consolidación de indicadores, según los módulos habilitados y los datos disponibles."
    ],
    [
      "¿La rentabilidad es siempre exacta?",
      "No se debe confundir margen estimado con beneficio neto. La medición exige costes completos, devoluciones y criterios coherentes."
    ],
    [
      "¿Funciona con Nixfarma, Farmatic y Unycop?",
      "La conexión con datos de Farmatic está operativa en un entorno concreto. Otras integraciones deben validarse por versión e instalación."
    ]
  ],
  "related": [
    "/soluciones/cuadro-mando-farmacias/",
    "/soluciones/analisis-compras-farmacia/",
    "/soluciones/control-stock-farmacia/",
    "/blog/integrar-farmatic-nixfarma-unycop-analitica/"
  ]
});
articles.push({
  "slug": "integrar-farmatic-nixfarma-unycop-analitica",
  "category": "Sistemas de farmacia",
  "title": "Cómo conectar Farmatic, Nixfarma o Unycop a una herramienta de análisis",
  "description": "Guía para integrar datos de Farmatic, Nixfarma o Unycop con analítica: permisos, ventas, compras, stock, CN, devoluciones y comprobaciones técnicas.",
  "hero": "Antes de conectar tu programa de farmacia, comprueba esto.",
  "lead": "No existe un conector universal que funcione por arte de magia. Farmatic, Nixfarma y Unycop tienen productos, versiones y vías de acceso diferentes. La forma fiable de construir analítica empieza por una revisión de datos y permisos, no por una promesa de compatibilidad.",
  "value": "Un buen proyecto de datos empieza por una conexión bien validada.",
  "sections": [
    {
      "heading": "1. Identifica el origen y quién autoriza el acceso",
      "paragraphs": [
        "Documenta el programa, su versión y el modelo de instalación. Confirma si los datos se consultan mediante una base de datos, un servicio autorizado, una exportación o un intermediario. Evita depender de accesos improvisados que puedan dejar de funcionar tras una actualización.",
        "Antes de mover información, define quién autoriza la consulta, qué farmacias están incluidas y qué campos son necesarios. La minimización de datos es especialmente relevante en el entorno sanitario."
      ]
    },
    {
      "heading": "2. Construye un diccionario común de ventas, compras y artículos",
      "paragraphs": [
        "El código de producto puede aparecer como CN, EAN u otro identificador de origen. Lo importante es conservar el identificador exacto, sus ceros iniciales y el vínculo inequívoco con el artículo. Las cantidades deben distinguir ventas y devoluciones.",
        "Registra igualmente las fechas, unidades, precios, descuentos, coste unitario de compra, proveedor, farmacia y stock cuando estén disponibles. Un campo con el mismo nombre no implica necesariamente el mismo significado en dos sistemas."
      ],
      "points": [
        "Identificadores de artículo sin conversiones destructivas.",
        "Tickets, líneas y fecha de operación.",
        "Importes antes y después de descuentos.",
        "Compras, proveedores y costes, cuando existan.",
        "Existencias y fecha de la fotografía de stock."
      ]
    },
    {
      "heading": "3. Verifica los números antes de publicar el cuadro de mando",
      "paragraphs": [
        "Selecciona varios días de ejemplo, una farmacia concreta y referencias conocidas. Compara la suma de unidades y ventas con informes del sistema de origen. Si los resultados no coinciden, revisa anulaciones, devoluciones, duplicados, zonas horarias y movimientos sin código.",
        "La actualización también importa: un informe que se refresca cada hora no puede presentarse como seguimiento instantáneo. Indica el momento del último dato y prepara alertas cuando una carga falle."
      ]
    },
    {
      "heading": "4. Mantén la lógica independiente del fabricante",
      "paragraphs": [
        "Una vez validados los datos, las preguntas comerciales son comparables: qué se vende, qué se compra, qué margen estimado existe, dónde se concentra el stock y cómo avanzan las promociones. El esquema analítico común reduce el trabajo al incorporar nuevas farmacias.",
        "En Farmetrica se ha validado un origen de ventas procedente de Farmatic. Las conexiones de Nixfarma y Unycop son posibilidades que deben estudiarse por instalación; esta guía no afirma que estén listas para utilizarse."
      ]
    },
    {
      "heading": "5. Cómo evaluar una integración antes de contratarla",
      "paragraphs": [
        "Pide una prueba con un conjunto limitado de datos reales y criterios de aceptación escritos. Una demostración visual no confirma que estén bien conciliadas las ventas ni que el margen esté calculado con costes correctos.",
        "Compara también el mantenimiento: quién se responsabiliza de los cambios de esquema, las incidencias, la frecuencia de refresco y la separación de datos de cada farmacia o cliente."
      ]
    }
  ],
  "faq": [
    [
      "¿Hay una clasificación objetiva de los programas más usados en España?",
      "No disponemos de una estadística independiente y actualizada de cuota de mercado por programa que permita publicar un ranking fiable. La enumeración aquí no implica orden de utilización."
    ],
    [
      "¿Puede utilizarse un CN como identificador?",
      "Sí cuando el origen lo emplea; conviene conservar ceros iniciales y validar la equivalencia con otros códigos."
    ],
    [
      "¿Es obligatorio copiar todos los datos del sistema?",
      "No. Se deben consultar o extraer solo los campos necesarios para el análisis acordado y autorizado."
    ]
  ],
  "related": [
    "/integraciones/farmatic/",
    "/integraciones/nixfarma/",
    "/integraciones/unycop/",
    "/soluciones/business-intelligence-farmacias/"
  ]
});
