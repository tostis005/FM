import React,{createContext,useContext} from "react";
import {hasSinglePharmacy} from "./pharmacyPresentation.js";

const SinglePharmacyContext=createContext(false);

// La cifra procede del contexto autorizado del usuario, no del resultado
// filtrado ni de la cantidad de filas cargadas.
export function PharmacyPresentationProvider({pharmacies,children}){
 return <SinglePharmacyContext.Provider value={hasSinglePharmacy(pharmacies)}>
  {children}
 </SinglePharmacyContext.Provider>;
}
export function useSinglePharmacy(){return useContext(SinglePharmacyContext);}
