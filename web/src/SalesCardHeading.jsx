import React from "react";
import "./salesCardHeading.css";

// Cabecera común de las tarjetas de Ventas: icono, tipografía y alineación.
export default function SalesCardHeading({icon:Icon,title}){
 return <div className="fm-sales-card-heading">
  <span className="fm-sales-card-heading-icon" aria-hidden="true"><Icon size={19}/></span>
  <h2>{title}</h2>
 </div>;
}
