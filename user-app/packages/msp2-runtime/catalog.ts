import { defineCatalog } from '@json-render/core'
import { schema } from '@json-render/react/schema'
import { z } from 'zod'

// Only references into the server-validated source are renderable. A model
// cannot supply HTML, CSS, URLs, actions, expressions or executable code.
const block = z.object({ id: z.string().min(1).max(80) }).strict()
export const slideCatalog = defineCatalog(schema, {
  components: {
    Slide: { props: z.object({ title: z.string() }).strict(), slots: ['default'], description: 'Fixed 1920 × 1080 slide, bounded 12-column grid.' },
    Text: { props: block, description: 'Exact source text, measured against readable font limits.' },
    Metric: { props: block, description: 'A value and its caption from the source.' },
    Group: { props: block, description: 'A heading, steps, list or quotation with its source fields.' },
    Component: { props: block, description: 'A qualified imported component with bound source fields.' },
    Table: { props: block, description: 'Native table using original cells and the design-system style.' },
    Chart: { props: block, description: 'Schema-driven chart using original labels and numeric series.' },
  },
  actions: {},
})
