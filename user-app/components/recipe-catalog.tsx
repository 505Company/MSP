"use client"
import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import type { CatalogCollection } from '@/lib/presentations/studio/recipe-catalog'
import { recipeTagLabels } from '@/lib/presentations/studio/recipe-metadata'
import Link from './site-link'
import './recipe-catalog.css'

export function RecipeCatalog({ collections }: { collections: CatalogCollection[] }) {
  const params = useSearchParams(), experimental = params.get('tag') === 'experimental'
  const [query, setQuery] = useState('')
  const needle = query.trim().toLocaleLowerCase('ru')
  const visible = collections.filter(c => !experimental || c.tags.includes('experimental')).map(c => ({ ...c,
    recipes: c.recipes.filter(r => [c.section, c.name, c.description, ...c.tags.map(t => recipeTagLabels[t]), r.id, r.name, r.family].join(' ').toLocaleLowerCase('ru').includes(needle)),
  })).filter(c => c.recipes.length)
  const total = collections.reduce((n, c) => n + c.recipes.length, 0)
  const count = visible.reduce((n, c) => n + c.recipes.length, 0)
  return <main className="ws-page pw ws-recipe-catalog">
    <header className="ws-heading"><div><h1>Рецепты</h1><p>Все подборки доступны в быстром и сбалансированном режимах. Последние две отмечены тегом «Экспериментальные».</p></div><Link className="pw-outline" href="/">Создать презентацию</Link></header>
    <div className="ws-recipe-tools">
      <nav className="ws-recipe-filters" aria-label="Фильтр рецептов">
        <Link href="/recipes" aria-current={!experimental ? 'page' : undefined}>Все <span>{collections.length}</span></Link>
        <Link href="/recipes?tag=experimental" aria-current={experimental ? 'page' : undefined}>Экспериментальные <span>{collections.filter(c => c.tags.includes('experimental')).length}</span></Link>
      </nav>
      <label className="ws-search"><Search size={17} aria-hidden="true"/><input type="search" aria-label="Найти рецепт" placeholder="Название, номер подборки или ID" value={query} onChange={event => setQuery(event.target.value)}/></label>
    </div>
    <p className="ws-recipe-count" role="status">Подборок: {visible.length} из {collections.length} · Вариантов: {count} из {total}</p>
    <div className="ws-recipe-collections">{visible.map(collection => {
      const original = collection.recipes.filter(r => !r.derived).length, derived = collection.recipes.length - original
      return <section key={collection.section} className="ws-recipe-collection" aria-labelledby={`recipe-${collection.section}`}>
        <header><div><p className="ws-recipe-source">Подборка {collection.section}</p><h2 id={`recipe-${collection.section}`}>{collection.name}</h2><p>{collection.description}</p></div>
          {collection.tags.map(tag => <Link key={tag} href={`/recipes?tag=${tag}`} className="ws-recipe-tag">{recipeTagLabels[tag]}</Link>)}
        </header>
        <details key={`${collection.section}:${needle}`} open={!!needle}>
          <summary>Варианты · {collection.recipes.length}{' '}<span>Исходных: {original}{derived ? ` · дополнительных: ${derived}` : ''}</span></summary>
          <ul>{collection.recipes.map(recipe => <li key={recipe.id}>
            <div><strong>{recipe.name}</strong>{recipe.derived && <span className="ws-recipe-derived">Дополнительный вариант</span>}</div>
            {recipe.family && <span className="ws-recipe-family">{recipe.family}</span>}<code>{recipe.id}</code>
          </li>)}</ul>
        </details>
      </section>
    })}</div>
    {!visible.length && <div className="ws-empty"><p>Рецептов по этому запросу нет.</p><button className="pw-outline" onClick={() => setQuery('')}>Очистить поиск</button></div>}
    <p className="ws-recipe-note">Зеркальные композиции и распределения блоков подбираются внутри вариантов по содержанию слайда.</p>
  </main>
}
