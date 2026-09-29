export const presentationStyles = [
  { id: "clear", name: "Чистый лист", description: "Светлый фон, ясная иерархия", background: "#ffffff", foreground: "#202124", accent: "#2458ed", font: "Arial", titleSize: 40, bodySize: 20, layout: "title-and-content" },
  { id: "editorial", name: "Редакционный", description: "Крупный заголовок и один акцент", background: "#f5f3ef", foreground: "#202124", accent: "#b84128", font: "Georgia", titleSize: 44, bodySize: 20, layout: "two-column" },
  { id: "night", name: "Тёмный", description: "Контраст для выступлений", background: "#202631", foreground: "#ffffff", accent: "#a8caff", font: "Arial", titleSize: 42, bodySize: 22, layout: "statement" },
] as const
export type PresentationStyle = typeof presentationStyles[number]
