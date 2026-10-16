// Objetivos de unidades de la hoja «OBJETIVOS OCTUBRE 2026» del Excel recibido.
// Orden de farmacias: Abadía (1), Buenavista (3), Europa (2), Valdemarías (5).
// null = no hay objetivo; Estación no aparece en el archivo.
// No son ventas: las ventas reales se consultan exclusivamente de PostgreSQL.
export const OCTOBER_2026_OBJECTIVES = [
  ["BEBE INNOVA","DR BROWN","50% DTO 2ª UD",25,12,25,16],
  ["BEBE INNOVA","CAPRICARE","4€ DTO",4,2,4,2],
  ["BEIERSDORF","EUCERIN","20% DTO",35,16,28,16],
  ["CANTABRIA LABS","IRALTONE","3x2",62,15,30,15],
  ["CANTABRIA LABS","NEORETIN","40% DTO 2ª UD",14,8,14,8],
  ["COMBE","VAGISIL","25% DTO",23,8,20,12],
  ["DENTAID","VITIS","20% DTO",16,10,16,12],
  ["DERMOFARM","SENSILIS","3x2",9,6,9,9],
  ["DRASANVI","VITAROMS","10% DTO",6,4,5,4],
  ["DRASANVI","MAGNESIOS","20% DTO",12,6,12,8],
  ["ESSITY","TENA LADY","10% DTO",12,6,10,6],
  ["ISDIN","ISDINCEUTICS / FOTOPROTECTORES","10€ DTO EN 2ª UD",60,20,40,30],
  ["ISDIN","UREADIN / GERMISDIN","30% DTO EN 2ª UD",20,8,25,10],
  ["ISDIN","ACNIBEN","3€ DTO",16,8,12,12],
  ["LOREAL","LA ROCHE POSAY EFFACLAR","20% DTO",36,18,40,16],
  ["NAOS","BIODERMA ATODERM","50% DTO 2ª UD",10,null,10,4],
  ["NAOS","BIODERMA SEBIUM","50% DTO 2ª UD",5,null,5,null],
  ["NATIVE","LIERAC","20% DTO",26,15,20,8],
  ["NUXE","CAPILAR","3€ DTO 1 UD 10€ DTO 2 UDS",10,6,10,8],
  ["OLISTIC","OLISTIC","20% DTO",3,2,3,2],
  ["P&G","KUKIDENT","30% DTO 2ªUD",40,14,20,14],
  ["P&G","DODOT","50% DTO 2ª UD",10,4,8,6],
  ["PIERRE FABRE","DUCRAY","20% DTO",50,24,28,10],
  ["PIERRE FABRE","KLORANE","10€ DTO",10,6,10,6],
  ["PIERRE FABRE","RENE FURTERER","10€ DTO",10,null,10,null],
  ["PIERRE FABRE","AVENE","20% DTO",20,12,18,8],
  ["PIERRE FABRE","AVENE CLEANANCE","15% DTO",30,25,20,16],
  ["PRANAROM","AROMALGIC","15% DTO",3,3,3,3],
  ["PRANAROM","AROMAPAR","25% DTO",3,3,3,3],
  ["PUIG DERMA","URIAGE","5€ DTO",5,3,5,3],
  ["RECKITT","DUREX","15% DTO",12,6,12,6],
  ["RECKITT","ENFAMIL","4+1",5,5,5,5],
  ["SUAVINEX","GAMA COSMETICA PEDIATRICA","20% DTO",10,8,10,8],
  ["SUNSTAR","GUM","3X2",15,10,15,8],
  ["SVR","ANTIEDAD","20% DTO",12,6,12,6],
];

export const OCTOBER_2026_OBJECTIVE_ROWS = [
  ...["1","3","2","5"].flatMap((id,index) => {
    const pharmacy = {1:"ABADIA",3:"BUENAVISTA",2:"EUROPA",5:"VALDEMARIAS"}[id];
    return [
      [2026,"OCTUBRE",pharmacy],
      ...OCTOBER_2026_OBJECTIVES
        .filter(row => Number.isInteger(row[index+3]))
        .map(row => [null,row[0],row[1],row[2],row[index+3]]),
    ];
  }),
];

export const OCTOBER_2026_OBJECTIVES_VERSION = "excel-objetivos-octubre-2026-v1";
