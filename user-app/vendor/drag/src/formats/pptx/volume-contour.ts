import type {GroupElementIR} from "../../core/model";
/** Single closed polygon from already-normalized editable geometry; never parse raw Office guides here. */
export function volumeContour(source:GroupElementIR):[number,number][]|undefined {
 const shapes=source.children.filter(n=>n.kind!=="text");if(shapes.length!==1)return undefined;
 const shape=shapes[0]!;if(shape.kind!=="path"||!shape.pathData||!shape.fill&&!shape.gradient&&!shape.pattern)return undefined;
 const tokens=shape.pathData.match(/[MLZ]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)??[];
 if(shape.pathData.replace(/[MLZ]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?|[\s,]/g,"")||tokens[0]!=="M"||tokens.at(-1)!=="Z")return undefined;
 const points:[number,number][]=[];let i=0;
 while(i<tokens.length-1){const op=tokens[i++];if(op!==(points.length?"L":"M"))return undefined;const x=Number(tokens[i++])+shape.bounds.x,y=Number(tokens[i++])+shape.bounds.y;if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>source.bounds.width||y>source.bounds.height)return undefined;if(points.length>=512)throw new Error("security-limit");points.push([x,y]);}
 return points.length>=3?points:undefined;
}
