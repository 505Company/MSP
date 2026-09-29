import type { ProfileResult } from "./types.js";

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderReport(result: ProfileResult): string {
  const profile = result.profile as any;
  const colors = profile.tokens.colors as Array<any>;
  const typography = profile.tokens.typography as Array<any>;
  const warnings = profile.warnings as Array<any>;
  const objectCountRows = Object.entries(result.summary.objectCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => `<tr><td>${escapeHtml(kind)}</td><td>${count}</td></tr>`)
    .join("");
  const slideRows = result.summary.slides
    .map((slide) => `<tr>
      <td>${slide.slideIndex + 1}</td>
      <td>${slide.objectCount}</td>
      <td>${escapeHtml(Object.entries(slide.kinds).map(([kind, count]) => `${kind}: ${count}`).join(", "))}</td>
      <td>${escapeHtml(slide.textSamples.join(" · ") || "—")}</td>
    </tr>`)
    .join("");
  const palette = colors
    .map((token) => `<li>
      <span class="swatch" style="background:${escapeHtml(token.hex)}"></span>
      <span><strong>${escapeHtml(token.hex)}</strong><small>${token.usageCount} objects · slides ${escapeHtml([...new Set(token.sources.map((source: any) => source.slideIndex + 1))].slice(0, 8).join(", "))}</small></span>
    </li>`)
    .join("");
  const typeRows = typography
    .slice(0, 40)
    .map((token) => `<tr>
      <td>${escapeHtml(token.fontFamily)}</td>
      <td>${escapeHtml(token.fontSizePt)} pt</td>
      <td>${escapeHtml(token.fontWeight)}${token.italic ? ", italic" : ""}</td>
      <td>${escapeHtml(token.roles.join(", "))}</td>
      <td>${token.usageCount}</td>
    </tr>`)
    .join("");

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Template Profile · ${escapeHtml(profile.source.fileName)}</title>
  <style>
    :root { font-family: Inter, Arial, sans-serif; color: #101828; background: #f5f7fa; }
    body { max-width: 1180px; margin: 0 auto; padding: 48px 28px 80px; }
    h1 { margin: 0 0 8px; font-size: 36px; }
    h2 { margin-top: 48px; font-size: 24px; }
    p, small { color: #667085; }
    .summary { display: flex; flex-wrap: wrap; gap: 28px; margin: 32px 0; padding: 24px 0; border-block: 1px solid #d0d5dd; }
    .metric strong { display: block; font-size: 28px; }
    .metric span { color: #667085; }
    .palette { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px 24px; }
    .palette li { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .palette small { display: block; margin-top: 3px; overflow-wrap: anywhere; }
    .swatch { width: 54px; height: 54px; flex: 0 0 auto; border-radius: 12px; border: 1px solid #d0d5dd; box-shadow: inset 0 0 0 1px rgba(255,255,255,.35); }
    table { width: 100%; border-collapse: collapse; background: white; }
    th, td { text-align: left; vertical-align: top; padding: 10px 12px; border-bottom: 1px solid #eaecf0; }
    th { color: #475467; font-size: 13px; background: #f9fafb; }
    .note { padding: 16px 18px; background: #fff8e7; border-left: 4px solid #fdb022; }
    code { overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <h1>Черновик профиля шаблона</h1>
  <p><strong>${escapeHtml(profile.source.fileName)}</strong><br><code>${escapeHtml(profile.source.sha256)}</code></p>
  <div class="summary">
    <div class="metric"><strong>${result.summary.slideCount}</strong><span>слайдов</span></div>
    <div class="metric"><strong>${result.summary.objectCount}</strong><span>объектов</span></div>
    <div class="metric"><strong>${colors.length}</strong><span>цветовых токенов</span></div>
    <div class="metric"><strong>${typography.length}</strong><span>типографических стилей</span></div>
    <div class="metric"><strong>${warnings.length}</strong><span>предупреждений</span></div>
  </div>
  <p class="note">Это первый технический срез. Он читает объекты непосредственно из PPTX и не учитывает полностью наследование геометрии из layouts/masters, трансформации вложенных групп и визуальную эквивалентность близких цветов.</p>

  <h2>Темы</h2>
  <p>${escapeHtml(result.summary.themeNames.join(", ") || "Название темы не найдено")}</p>

  <h2>Палитра</h2>
  <ul class="palette">${palette || "<li>Цвета не найдены</li>"}</ul>

  <h2>Типографика</h2>
  <table><thead><tr><th>Шрифт</th><th>Размер</th><th>Начертание</th><th>Предполагаемая роль</th><th>Объектов</th></tr></thead><tbody>${typeRows}</tbody></table>

  <h2>Типы объектов</h2>
  <table><thead><tr><th>Тип</th><th>Количество</th></tr></thead><tbody>${objectCountRows}</tbody></table>

  <h2>Слайды и provenance</h2>
  <table><thead><tr><th>Слайд</th><th>Объектов</th><th>Типы</th><th>Пример текста</th></tr></thead><tbody>${slideRows}</tbody></table>
</body>
</html>`;
}
