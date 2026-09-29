import {studioFixture} from './studio'
import {backgroundFixture} from './backgrounds'
import {buildBackgroundCatalog} from '../../lib/design-system/backgrounds'

export function sourceStyleFixture(){
  const {library}=studioFixture(),fixture=backgroundFixture()
  if(fixture.fill.kind!=='rectangle')throw Error('fixture')
  fixture.fill.fill={type:'solid',color:{r:0,g:0,b:0,a:1}}
  fixture.snapshot.elements[0].properties=fixture.fill as unknown as Record<string,unknown>
  library.backgrounds=buildBackgroundCatalog(fixture.snapshot,fixture.library,'dark-source')
  library.tokens.colors=[{hex:'#7F7F7F',occurrences:1000},{hex:'#FFFFFF',occurrences:141},{hex:'#000000',occurrences:179},{hex:'#0077FF',occurrences:122},{hex:'#70C3FF',occurrences:20},{hex:'#EB4250',occurrences:4}]
  return library
}

