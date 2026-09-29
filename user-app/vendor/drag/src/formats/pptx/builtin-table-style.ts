import {DRAWING as A} from "./catalog";
import {tableBases,tableVariants,type StyleTemplate} from "./builtin-table-data";
/** Normative built-in definitions. Explicit definitions in the source package win. */
export function builtinTableStyle(id:string,doc:Document):Element|undefined{
 const key=id.toUpperCase();if(!Object.hasOwn(tableVariants,key))return undefined;
 const variant=tableVariants[key]!,template=tableBases[variant.base]!;
 const make=(source:StyleTemplate,parents:string[]):Element=>{
  const node=doc.createElementNS(A,`a:${source.name}`);
  for(const [name,original]of Object.entries(source.attributes)){
   let value=original;
   if(source.name==="schemeClr"&&name==="val"&&value===variant.from){
    const keep=variant.preserveLastTop&&parents.includes("lastRow")&&parents.includes("top");
    if(!keep)value=parents.includes("firstRow")?(variant.header??variant.to??value):(variant.to??value);
   }
   node.setAttribute(name,value);
  }
  for(const item of source.children)node.appendChild(make(item,[...parents,source.name]));return node;
 };
 const root=make(template,[]);root.setAttribute("styleId",key);root.setAttribute("styleName",variant.name);return root;
}
