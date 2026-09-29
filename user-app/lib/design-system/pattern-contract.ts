import {z} from 'zod'
import type {ShapeElementIR} from '../../vendor/drag/src/core/model'

export const PATTERN_VERSION='editable-pattern-1'
const number=z.number().finite(),positive=number.positive().max(10000),hex=z.string().regex(/^#[\da-f]{6}$/i)
export const primitiveSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('ellipse')}).strict(),
 z.object({kind:z.literal('sector'),sweep:z.literal(270)}).strict(),
 z.object({kind:z.literal('rounded'),corners:z.tuple([number.min(0).max(1),number.min(0).max(1),number.min(0).max(1),number.min(0).max(1)])}).strict(),
])
export type PatternPrimitive=z.infer<typeof primitiveSchema>
export const patternGeometrySchema=z.object({width:positive,height:positive,background:hex.nullable(),
 parts:z.array(z.object({id:z.string().regex(/^part-\d+$/),primitive:primitiveSchema,aspect:positive}).strict()).min(1).max(64),
 instances:z.array(z.object({partId:z.string().regex(/^part-\d+$/),x:number.min(-10000).max(10000),y:number.min(-10000).max(10000),width:positive,height:positive,color:hex,rotation:z.union([z.literal(0),z.literal(90),z.literal(180),z.literal(270)])}).strict()).min(3).max(128),
 palette:z.array(hex).min(1).max(8),
 quality:z.object({foregroundIou:number.min(0).max(1),pixelError:number.min(0).max(1),paletteCoverage:number.min(0).max(1),smallFragmentRatio:number.min(0).max(1)}).strict(),
}).strict()
export type PatternGeometry=z.infer<typeof patternGeometrySchema>
export type PatternPart={id:string;primitive?:PatternPrimitive;element?:ShapeElementIR;aspect:number}
export type PatternDefinition=Omit<PatternGeometry,'parts'|'quality'>&{parts:PatternPart[];quality:PatternGeometry['quality']|null;origin:'native'|'reconstructed';
 rules:{gapRatio:number;rotations:Array<0|90|180|270>;basis:'observed'|'model';allowRecolor:boolean}}
export const patternRecognitionSchema=z.object({kind:z.enum(['pattern','photo','logo','chart','illustration','other']),name:z.string().min(1).max(100),description:z.string().max(240),
 rotations:z.array(z.union([z.literal(0),z.literal(90),z.literal(180),z.literal(270)])).min(1).max(4),allowRecolor:z.boolean(),reason:z.string().max(400)}).strict()
export type PatternRecognition=z.infer<typeof patternRecognitionSchema>
