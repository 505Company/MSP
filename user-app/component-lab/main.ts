/// <reference types="vite/client" />
import './style.css'
import { mountComponentEditor } from './editor'
const editor = mountComponentEditor(document.getElementById('app')!)
Object.defineProperty(window, '__componentLab', { configurable: true, get: editor.inspect })
if (import.meta.hot) import.meta.hot.dispose(() => editor.dispose())
