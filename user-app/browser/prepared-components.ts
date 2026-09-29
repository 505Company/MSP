import type { PreparedBox } from '../lib/presentations/prepared-components'
import type { BoxConstraints, ComponentContent, ComponentMeasurement,ComponentState } from '../lib/component-lab/contract'
import { LAB_VERSION } from '../lib/component-lab/contract'
import { digest } from '../lib/component-lab/source'
import { sourceFonts } from './component-lab/fonts'
import { measureComponent, renderCommittedComponent, pixelEvidence } from './component-lab/measure'

// A generation owns immutable pinned profiles. Validate each pin's resources
// once, including rejected pins, rather than fetching their manifest in every
// geometry/font attempt. A new snapshot gets a new key and is checked afresh.
const resourcesByPin=new WeakMap<PreparedBox,Map<string,ReturnType<typeof sourceFonts>>>()

/** The generator supplies content and a box. The component may return measured
 * alternatives, but never changes neighboring blocks or rewrites content. */
export async function preparedResources(upload: string, pin: PreparedBox) {
  let uploads=resourcesByPin.get(pin)
  if(!uploads){uploads=new Map();resourcesByPin.set(pin,uploads)}
  let pending=uploads.get(upload)
  if(!pending){
    pending=(async()=>{
      if (pin.version !== `preparation-1:${pin.profile.version}:${LAB_VERSION}` || pin.fidelity.status !== 'preserved') throw Error('prepared-component-version')
      const resources = await sourceFonts(upload, pin.profile, true)
      if (await digest(resources.faces ?? []) !== await digest(pin.faces) || await digest(resources.artwork?.assets ?? []) !== await digest(pin.assets)) throw Error('prepared-component-resources-changed')
      return resources
    })()
    uploads.set(upload,pending)
  }
  return pending
}
export async function measurePreparedBox(upload: string, pin: PreparedBox, content: ComponentContent, constraints: BoxConstraints, target?: HTMLElement, checkPixels = true, options:{maxTypeStep?:number;preferredState?:ComponentState}={}) {
  const resources = await preparedResources(upload, pin)
  const measurement = await measureComponent(pin.profile, content, constraints, resources, { target,...options })
  const evidence = measurement.status === 'fits' && target && checkPixels ? await pixelEvidence(target.firstElementChild as HTMLElement, measurement.chosen!, resources) : undefined
  return { measurement, resources, evidence }
}
export async function renderPreparedBox(target: HTMLElement, upload: string, pin: PreparedBox, content: ComponentContent, measurement: ComponentMeasurement) {
  return renderCommittedComponent(target, pin.profile, content, measurement, await preparedResources(upload, pin))
}
