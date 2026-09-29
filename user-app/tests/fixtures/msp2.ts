import { MSP2_VERSION, type DesignLibrary, type Run } from '../../lib/msp2/types'
import { localPlan, sourcePackets } from '../../lib/msp2/planner'
export const msp2Text = `# Сервис растёт вместе с клиентами
76%
клиентов возвращаются за новой поездкой
24%
рост числа бронирований за год
Источник: внутренняя аналитика, 2026
---
# Спрос становится равномернее
Слева — линейный график «Поездки»:
Месяц\t2025\t2026
Январь\t12\t18
Февраль\t20\t26
Март\t32\t40
Справа — вывод:
Путешественники чаще выбирают поездки вне высокого сезона.
---
# План и результат
Направление\tПлан\tФакт
Командировки\t120\t126
Семьи\t90\t94
Пары\t110\t117`
export function msp2Library(): DesignLibrary {
  return { id: 'a'.repeat(64), uploadId: 'a7e332ce-47fa-44e8-94bc-ddf9845afed2', name: 'Тестовая дизайн-система', tokens: { fonts: [{ family: 'Play', sizes: [28, 36, 72], occurrences: 5 }], colors: [{ hex: '#FFFFFF', occurrences: 8 }, { hex: '#162D40', occurrences: 5 }, { hex: '#00805E', occurrences: 4 }] }, rules: [], prepared: {}, editable: [] }
}
export function msp2Run(text = msp2Text): Run {
  const library = msp2Library(), packets = sourcePackets(text)
  return { version: MSP2_VERSION, projectId: crypto.randomUUID(), revision: crypto.randomUUID(), createdAt: new Date().toISOString(), mode: 'local', library, packets, plans: Object.fromEntries(packets.map(p => [p.id, localPlan(p, library)])), results: {}, errors: {}, modelRuns: {} }
}
