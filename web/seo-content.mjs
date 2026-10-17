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
{heading:"Toda la información de la campaña, en su sitio",paragraphs:["Un nombre claro, un laboratorio, una descripción comercial, el periodo de vigencia, los códigos nacionales incluidos y las farmacias participantes. Son datos que normalmente viajan en correos y hojas de cálculo; reunirlos reduce discrepancias.","En Farmetrica las campañas pueden crearse y consultarse con ese contexto. También es posible importar promociones desde Excel cuando el documento presenta una estructura compatible."],points:["Productos definidos por CN de seis dígitos.","Ofertas y condiciones comerciales asociadas a cada campaña.","Farmacias participantes con sus objetivos en unidades.","Estados para distinguir campañas en preparación, activas y finalizadas."]},
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
{heading:"Del dato de venta al progreso comercial",paragraphs:["El seguimiento combina los CNs de la promoción, su periodo y las farmacias incluidas. Cuando se dispone de una conexión operativa, los datos proceden de las líneas de venta del sistema de farmacia.","En el entorno actual, Farmetrica consulta datos de Farmatic cargados en PostgreSQL. Esta diferencia es importante: una cifra de ejemplo o un fichero recibido por correo no debe confundirse con ventas contrastadas."],points:["Unidades vendidas por farmacia.","Comparación con el objetivo asignado.","Porcentaje de cumplimiento.","Detalle de tickets disponible para usuarios autorizados."]},
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
slug:"cuadro-mando-farmacias",category:"Analítica",title:"Cuadro de mando comercial para farmacias",
description:"KPIs comerciales de campañas y farmacias: objetivos, ventas, porcentaje de avance y seguimiento consolidado con filtros y desglose.",
hero:"Una visión clara de lo que está ocurriendo en tu farmacia.",
lead:"Los cuadros de mando útiles no son los que muestran más gráficos, sino los que ayudan a encontrar una respuesta. Farmetrica está pensado para analizar campañas por farmacia sin perder la posibilidad de bajar al detalle.",
value:"Del indicador al porqué.",
sections:[
{heading:"Indicadores que importan al responsable",paragraphs:["El cuadro de mando pone en relación campañas activas, unidades objetivo, unidades vendidas y avance. El responsable puede ver el conjunto y profundizar en las farmacias que necesitan una revisión.","No se trata de calcular un beneficio que no esté sustentado por los datos. El seguimiento actual está centrado en unidades y progreso comercial; para medir margen o rentabilidad económica es necesario contar también con costes y criterios adecuados."],points:["Número y estado de campañas.","Objetivos previstos por farmacia.","Ventas y cumplimiento, cuando existe integración.","Detalle por promoción y códigos nacionales."]},
{heading:"Comparación sin perder matices",paragraphs:["Un agregado puede ocultar comportamientos muy distintos. Una farmacia con menos unidades vendidas puede estar alcanzando mejor su objetivo; otra puede concentrar el volumen, pero quedarse por debajo de la meta fijada.","Los filtros ayudan a distinguir ambos escenarios y a preparar un seguimiento razonado, especialmente en grupos de farmacias."]},
{heading:"Un panel orientado a la acción",paragraphs:["La navegación permite acceder al listado de campañas, abrir su detalle y revisar los resultados de cada farmacia. La información se presenta con tablas ordenables, paginación y filtros por valores conocidos.","El objetivo es que el cuadro de mando forme parte de la rutina comercial, no que se convierta en una tarea adicional de mantenimiento de informes."]}
],
faq:[
["¿Farmetrica sustituye al programa de gestión?","No. Está diseñada para complementar el sistema de farmacia utilizando su información comercial cuando existe una conexión habilitada."],
["¿Puedo usarla para varias farmacias?","Sí. El seguimiento contempla distintas farmacias y una visión conjunta de campañas."],
["¿Muestra márgenes o beneficios calculados?","El seguimiento descrito se centra en ventas, unidades y objetivos. Un análisis económico fiable requiere datos adicionales de costes y reglas de negocio."]
],
related:["/soluciones/grupos-de-farmacias/","/soluciones/seguimiento-ventas-farmacia/","/blog/indicadores-promociones-farmacia/"]
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
slug:"grupos-de-farmacias",category:"Redes y grupos",title:"Software comercial para grupos y redes de farmacias",
description:"Coordina promociones, objetivos y seguimiento de ventas de varias farmacias desde una visión conjunta con desglose por punto de venta.",
hero:"Muchas farmacias. Una estrategia comercial comprensible.",
lead:"En un grupo de farmacias, la coordinación comercial se complica cuando cada punto de venta utiliza una hoja distinta. Farmetrica reúne campañas y seguimiento para ofrecer un marco compartido de trabajo.",
value:"Coordinar la red sin perder la realidad local.",
sections:[
{heading:"La misma campaña, metas diferentes",paragraphs:["La promoción puede negociarse para un grupo y ejecutarse en farmacias de tamaños muy distintos. Por eso conviene asignar una meta específica a cada participante, sin depender exclusivamente de un objetivo agregado.","Farmetrica contempla la participación por farmacia, el objetivo de unidades y un seguimiento comercial relacionado con las referencias y periodos de cada campaña."]},
{heading:"Visión global y revisión por farmacia",paragraphs:["La red necesita una lectura conjunta para saber cuánto avanza, pero los responsables locales requieren cifras de su propio establecimiento. Un panel puede presentar ambas vistas sin obligar a mantener informes paralelos.","Cuando se seleccionan varias campañas, el consolidado permite observar el conjunto; el detalle de cada promoción ayuda a estudiar diferencias."]},
{heading:"Organización y acceso",paragraphs:["La aplicación incorpora un módulo de usuarios y accesos, con ámbitos de gestión por farmacia previstos en el modelo de la plataforma. Los permisos efectivos dependen de la configuración de cada cliente y de los controles aplicados en el servidor.","La implantación debe validar roles, identidad, origen de datos y responsables antes de incorporar nuevas farmacias."]}],
faq:[
["¿Pueden participar solo algunas farmacias en una promoción?","Sí. Las campañas contemplan farmacias participantes y objetivos particulares."],
["¿Hay una vista conjunta de todas las ventas?","Existe seguimiento consolidado para varias campañas y detalle por farmacia en entornos con ventas conectadas."],
["¿Sirve para grupos con programas de gestión diferentes?","Es un objetivo de evolución de la plataforma, pero cada integración distinta de Farmatic necesita evaluación y validación técnica."]
],
related:["/soluciones/cuadro-mando-farmacias/","/soluciones/gestion-promociones-farmacia/","/integraciones/"]
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
slug:"gestion-usuarios-farmacias",category:"Accesos",title:"Usuarios y accesos para plataformas de grupos de farmacias",
description:"Organiza usuarios, roles y permisos de acceso a una plataforma de promociones con varias farmacias y distintas responsabilidades.",
hero:"La información correcta para cada responsabilidad.",
lead:"No todas las personas necesitan ver lo mismo. Una red puede tener responsables comerciales, gestores y equipos de farmacia con tareas distintas. La organización de accesos forma parte del diseño del sistema.",
value:"Una plataforma compartida requiere control de accesos.",
sections:[
{heading:"Perfiles y permisos con propósito",paragraphs:["El panel administrativo contempla gestión de usuarios, correos autorizados, dominios y roles. La configuración de permisos debe vincular las responsabilidades de cada usuario con los datos que realmente necesita consultar.","Los cambios de acceso deben protegerse en el servidor y no depender solo de ocultar una opción en el navegador."]},
{heading:"Farmacias asignadas y responsables de red",paragraphs:["Un gestor de grupo puede necesitar una visión completa para coordinar campañas, mientras que un responsable local se centra en sus farmacias. Asignar ámbitos claros permite diseñar una experiencia menos confusa y más apropiada.","Antes de desplegar un sistema multiempresa hay que verificar también el aislamiento de datos entre clientes; un selector visual por sí solo no ofrece esa seguridad."]},
{heading:"Autenticación y seguridad operativa",paragraphs:["El acceso privado de Farmetrica dispone de una página de inicio de sesión diferenciada de la web comercial. Las capacidades de autenticación disponibles dependen de la configuración del entorno.","Las integraciones de identidad corporativa y el SSO requieren sus correspondientes credenciales y una implantación específica; no conviene confundir esa posibilidad con una conexión universal lista de serie."]}
],
faq:[
["¿La landing pública da acceso a ventas?","No. Los recursos del panel privado siguen sujetos a autenticación."],
["¿Puedo organizar usuarios por farmacia?","La plataforma dispone de entidades de usuario y farmacia para configurar ámbitos y responsables."],
["¿El SSO corporativo está activado por defecto?","No. Es necesario configurar el proveedor de identidad y verificar cada implantación."]
],
related:["/soluciones/grupos-de-farmacias/","/soluciones/cuadro-mando-farmacias/","/"]
}
];

export const integrations=[
{
slug:"farmatic",category:"Origen conectado",title:"Farmetrica y Farmatic: seguimiento comercial de ventas",
description:"Cómo usa Farmetrica las ventas originadas en Farmatic y consultadas en PostgreSQL para medir objetivos y promociones por farmacia.",
hero:"Aprovecha los datos de Farmatic para seguir tus promociones.",
lead:"El entorno actual de Farmetrica tiene una conexión operativa con datos de ventas procedentes de Farmatic, disponibles para consulta en PostgreSQL. Esa información alimenta indicadores y detalle de campañas.",
value:"Integración operativa en el entorno actual, no garantía de conexión automática a cualquier instalación.",
sections:[
{heading:"Qué se analiza",paragraphs:["Los CNs, fechas y farmacias definidos en cada campaña delimitan las ventas relevantes. A partir de esas líneas se calculan unidades vendidas y porcentajes de avance sobre los objetivos asignados.","El detalle disponible puede incluir documento de venta, fecha, descripción del producto, cantidades e importes, sujeto a la información de origen y a los permisos de acceso."]},
{heading:"Cómo se organiza la información",paragraphs:["Farmetrica no sustituye a Farmatic como programa de farmacia. El enfoque consiste en aprovechar la información de ventas ya existente y ofrecer una capa de seguimiento comercial orientada a promociones y objetivos.","La carga de datos, frecuencia de actualización y permisos se validan en cada instalación. La conexión operativa demostrada en el entorno actual no significa compatibilidad automática con todas las versiones."]},
{heading:"Del ticket al Excel de laboratorio",paragraphs:["En los entornos conectados, las campañas pueden exportarse con detalle de líneas de venta. Una campaña genera un Excel y varias campañas pueden agruparse en un ZIP con un archivo independiente por cada una.","Este proceso aporta trazabilidad a la revisión comercial, sin alterar las operaciones originales del programa de farmacia."]}
],
faq:[
["¿Farmetrica sustituye a Farmatic?","No, complementa su información para analizar campañas comerciales y objetivos."],
["¿La conexión está disponible para cualquier instalación?","La integración actual está operativa en un entorno concreto. Cada instalación requiere comprobar accesos, estructuras y actualización de datos."]
],
related:["/integraciones/","/soluciones/seguimiento-ventas-farmacia/","/soluciones/reporting-laboratorios/"]
},
{
slug:"nixfarma",category:"Compatibilidad en estudio",title:"Nixfarma y el análisis de promociones de farmacia",
description:"Conoce qué necesitaría una conexión entre Nixfarma y Farmetrica para analizar campañas, objetivos y ventas. Integración en estudio, no disponible aún.",
hero:"¿Trabajas con Nixfarma? Hablemos de tus datos comerciales.",
lead:"Nixfarma es uno de los programas utilizados para gestionar la actividad diaria de una farmacia. Farmetrica estudia cómo ampliar su modelo de seguimiento a otros orígenes, pero la conexión con Nixfarma todavía no está desarrollada ni validada.",
value:"Integración prevista: pendiente de análisis técnico y autorización.",
sections:[
{heading:"Qué datos necesita el seguimiento de promociones",paragraphs:["Para contrastar ventas y objetivos hacen falta códigos de producto, fecha de operación, cantidades, farmacia de origen y un criterio consistente para las anulaciones o devoluciones.","El primer paso es comprobar qué datos puede proporcionar la instalación de Nixfarma de forma autorizada y cómo se mantienen actualizados."]},
{heading:"Por qué no basta con decir que es compatible",paragraphs:["Nixfarma publica información sobre integraciones y conectores oficiales. La extracción de datos sin una vía mantenida y autorizada puede generar incoherencias o dejar de funcionar con una actualización.","Por eso Farmetrica distingue entre el sistema Farmatic ya conectado en su entorno actual y Nixfarma, cuya conexión forma parte de una evaluación posterior."]},
{heading:"Cómo sería el análisis después de una integración validada",paragraphs:["El modelo previsto permitiría definir campañas por CN, asignar objetivos diferentes a las farmacias participantes y comparar resultados, siempre que el origen facilite los datos y permisos necesarios.","Mientras no exista esa conexión validada, no se ofrece como una funcionalidad operativa para Nixfarma."]}
],
faq:[
["¿Farmetrica se conecta hoy directamente con Nixfarma?","No. La integración con Nixfarma está prevista, pero pendiente de desarrollo y validación."],
["¿Puedo cargar campañas en Excel aunque use Nixfarma?","La importación de información de campañas y objetivos es distinta de la integración de ventas. El seguimiento de tickets reales requiere una fuente conectada."],
["¿Farmetrica es un producto oficial de Nixfarma?","No. Los nombres de programas se citan con fines descriptivos y no implican asociación comercial."]
],
related:["/integraciones/","/integraciones/farmatic/","/soluciones/importar-campanas-excel/"]
},
{
slug:"unycop",category:"Compatibilidad en estudio",title:"Unycop y los cuadros de mando de promociones",
description:"Análisis de posibles conexiones de Unycop WIN o NEXT con Farmetrica para objetivos y promociones. Integración aún no disponible.",
hero:"Unycop y seguimiento comercial: qué conviene conectar.",
lead:"Una farmacia que utiliza Unycop puede necesitar una lectura comercial específica de sus promociones. Farmetrica contempla ese caso de uso, aunque todavía no dispone de una integración con Unycop implantada y verificada.",
value:"Posibilidad en evaluación, no conector disponible actualmente.",
sections:[
{heading:"Objetivos, CN y ventas: las piezas que deben encajar",paragraphs:["La gestión promocional precisa relacionar las referencias implicadas, el periodo de vigencia y las unidades registradas por farmacia. También es necesario distinguir devoluciones, movimientos anulados y otras particularidades del origen.","El diseño de una integración debe tratar esas reglas antes de presentar indicadores como si fueran comparables entre programas."]},
{heading:"Versiones y vías de conexión",paragraphs:["Unycop dispone de diferentes productos y versiones, como WIN y NEXT, con capacidades propias. El fabricante describe herramientas de exportación y APIs para algunos usos; eso no significa que ya exista un conector desarrollado por Farmetrica.","La viabilidad depende de la versión instalada, los datos accesibles, permisos y condiciones técnicas de integración."]},
{heading:"El objetivo: conservar la lógica comercial",paragraphs:["Una vez validada una fuente de datos, el valor del panel se encuentra en comparar objetivos y ventas por farmacia, agrupar campañas y producir informes adecuados para el seguimiento con laboratorios.","Hasta entonces, la opción responsable es presentar Unycop como integración en estudio y no prometer compatibilidad universal."]}
],
faq:[
["¿La integración con Unycop está operativa?","No. Actualmente es una posibilidad en estudio."],
["¿Funciona igual con Unycop WIN y NEXT?","No puede darse por hecho; cada versión y sus mecanismos autorizados de acceso requieren evaluación."],
["¿Se puede gestionar la definición de campañas sin conectar las ventas?","La creación e importación de campañas son funciones distintas del acceso a ventas reales. Sin integración no se debe presentar un seguimiento de tickets como actualizado."]
],
related:["/integraciones/","/integraciones/nixfarma/","/soluciones/gestion-promociones-farmacia/"]
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
{heading:"Qué representa un código nacional en la campaña",paragraphs:["El CN permite relacionar un producto concreto con los registros comerciales y es especialmente útil cuando hay tamaños, presentaciones o variantes dentro de una misma gama.","En los datos de importación de Farmetrica, los códigos se manejan en el formato de seis dígitos utilizado por el sistema, preservando ceros iniciales cuando corresponde."]},
{heading:"Nombres de promoción y CN cumplen tareas distintas",paragraphs:["Una campaña se comunica con un nombre comprensible para el equipo, como «Higiene bucal 3x2». La venta registrada, en cambio, necesita saber qué referencias participaron exactamente.","Si el listado de CNs está incompleto, el seguimiento puede omitir unidades legítimas. Si incluye productos ajenos a la oferta, puede sobrestimar su rendimiento."]},
{heading:"Buenas prácticas de importación",paragraphs:["Conviene comprobar los códigos antes de lanzar la promoción y revisar qué sucede con referencias nuevas o descatalogadas.","Al importar desde Excel, la validación de CNs, la oferta y el periodo deben conservarse juntos. Esto facilita conciliar campañas similares y evita usar una descripción como único identificador."]},
{heading:"De la referencia al ticket de venta",paragraphs:["Con una fuente de datos conectada, el sistema puede contrastar las líneas de venta de los CNs participantes en un intervalo de fechas. El resultado gana valor cuando también se vincula a la farmacia de origen.","Esta lectura no debe confundirse con un análisis de receta electrónica o información clínica; el propósito descrito es exclusivamente comercial."]}
],
faq:[["¿Puedo usar varios CNs en una campaña?","Sí. Una promoción puede incluir diferentes referencias y gamas."],["¿Es suficiente filtrar por nombre de producto?","No siempre: nombres y descripciones varían. Un código validado ofrece una referencia comercial más precisa."]],
related:["/soluciones/gestion-promociones-farmacia/","/soluciones/importar-campanas-excel/","/soluciones/seguimiento-ventas-farmacia/"]
}
];
