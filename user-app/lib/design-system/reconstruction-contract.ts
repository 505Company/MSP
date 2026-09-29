import {z} from 'zod'
import {diagramRecognitionSchema,type DiagramGraph,RECONSTRUCTION_VERSION} from './diagram-graph'
import {patternRecognitionSchema,type PatternDefinition} from './pattern-contract'
export {RECONSTRUCTION_VERSION}
export const recognitionSchema=z.union([patternRecognitionSchema,diagramRecognitionSchema])
// JSON-schema serializer covers only the data primitives used by this contract.
export function modelSchema(schema:z.ZodTypeAny):Record<string,unknown>{
 if(schema instanceof z.ZodObject){const shape=schema.shape as Record<string,z.ZodTypeAny>;return {type:'object',additionalProperties:false,properties:Object.fromEntries(Object.entries(shape).map(([k,v])=>[k,modelSchema(v)])),required:Object.keys(shape)}}
 if(schema instanceof z.ZodUnion)return {anyOf:schema.options.map(modelSchema)}
 if(schema instanceof z.ZodDiscriminatedUnion)return {anyOf:[...schema.options.values()].map(modelSchema)}
 if(schema instanceof z.ZodNullable)return {anyOf:[modelSchema(schema._def.innerType),{type:'null'}]}
 if(schema instanceof z.ZodArray)return {type:'array',items:modelSchema(schema.element)}
 if(schema instanceof z.ZodEnum)return {type:'string',enum:schema.options}
 if(schema instanceof z.ZodLiteral)return {const:schema.value,type:typeof schema.value}
 if(schema instanceof z.ZodNumber)return {type:'number'}
 if(schema instanceof z.ZodBoolean)return {type:'boolean'}
 if(schema instanceof z.ZodString)return {type:'string'}
 throw Error('Неизвестный тип контракта распознавания')
}
export type ReconstructionCandidate={id:string;assetId?:string;componentIds:string[];sourceIds:string[];slides:number[];name:string;templateId?:string;graph?:DiagramGraph}
export type TextCalibration={nodeId:string;sourceTextId:string;elements:import('../../vendor/drag/src/core/model').TextElementIR[]}
export type ReconstructionResult={recognitionIssue?:string;modelPrefix?:string;partsQualification?:import('./graphic-components').GraphicPartsReport;fonts?:string[];textCalibration?:TextCalibration[];id:string;name:string;description:string;status:'pending-check'|'ready'|'retained';reason:string;candidate:ReconstructionCandidate;pattern?:PatternDefinition;diagram?:DiagramGraph;modelRunId?:string;quality?:{pixelError:number;foregroundIou:number};qualification?:{passed:boolean;issues:string[];pixelError:number;foregroundRecall:number;changed:boolean;version:string}}
export type ReconstructionCatalog={graphicSystem?:import('./graphic-components').GraphicSystem;version:string;id:string;sourceCatalogId:string;editableCatalogId:string;results:ReconstructionResult[]}
export type ReconstructionState={version:string;revision:string;pending:ReconstructionCandidate[];completed:number;total:number;catalog:ReconstructionCatalog|null;results:ReconstructionResult[]}
export const reconstructionInputSchema=z.object({nativeOnly:z.boolean().optional(),revision:z.string().regex(/^[a-f0-9]{64}$/),candidateId:z.string().regex(/^[\w-]{1,140}$/),pixels:z.object({width:z.number().int().min(24).max(768),height:z.number().int().min(24).max(768),rgba:z.string().max(3150000).regex(/^[A-Za-z0-9+/]+=*$/)}).strict().optional()}).strict()
