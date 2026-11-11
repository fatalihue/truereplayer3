import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { BridgeProvider } from './bridge/BridgeContext'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { Shell } from './shell/Shell'
import { ShellBridge } from './shell/ShellBridge'
import { useShell } from './shell/store'
import { ThemeProvider } from './state/ThemeContext'
import { ToastProvider } from './state/ToastContext'
import { applyThemeConfig, loadCustomPresets, loadThemeConfig, resolveThemeColors } from './themes'
// Teclado (branch teclado): in Vite, without WebView2, a fake engine answers with sample data — only
// when asked (VITE_TECLADO_DEMO=1, set by the vite-mk preview), so the e2e tests keep the bridge's own
// postMessage fallback. Imported only in development, so none of it reaches the app's bundle (rule 6);
// the first render waits for it.
const demo = import.meta.env.DEV && import.meta.env.VITE_TECLADO_DEMO === '1' && !window.chrome?.webview
  ? import('./shell/mk/demoEngine').then(m => m.installDemoEngine())
  : null

// The theme's TOKENS go on <html> before the first render; data-animations stays off until
// ThemeProvider's mount effect turns it on.
//
// The boot mirror in index.html paints only the fifteen base colours and the sizes. Every derived
// token (the -fg / -ink solves, the action pills, shadows, color-scheme) used to arrive in
// ThemeProvider's mount effect, after the first commit had already styled the whole UI with the
// index.css fallbacks — and the same style change switched on the global 180 ms colour transition
// (index.css, html[data-animations="true"]). Every element whose colour moved started a transition,
// and since `color` is inherited, each one handed a moving value to all of its descendants, which
// started their own: ~1,600 transitions and ten more whole-UI style passes in the first ~250 ms
// after launch (measured, 4× CPU throttle: ~300 ms of style work once the window was already up).
//
// With the tokens in place first, the first style pass already sees the final colours, and the
// effect's only change is the attribute — turning a transition ON starts nothing, because no value
// moves with it. The attribute is held back rather than written here because this script can run
// before the stylesheet has been applied: anything restyled from unstyled to styled while the
// transition is on would start the same cascade. ThemeProvider still owns the theme from here on;
// its effect computes the same declaration, and applyThemeConfig skips the identical cssText.
const bootTheme = loadThemeConfig()
applyThemeConfig(resolveThemeColors(bootTheme, loadCustomPresets()), bootTheme.uiSettings, false)

// The app is the new shell (TrueReplayer 3). The shell TrueReplayer 2 had left the code in phase E;
// components/ keeps only the parts the new one reuses. The shell asks the engine to save as you go and
// to undo the macro's settings too (ui:capabilities).
const CAPABILITIES = { autoSave: true, extendedUndo: true }

const render = () => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Two boundaries, as in TrueReplayer 2's shell: the outer one catches a provider crash, the inner
        one a shell crash with the theme still applied. */}
    <ErrorBoundary>
      <ThemeProvider>
        <BridgeProvider capabilities={CAPABILITIES}>
          <ShellBridge>
            {/* The engine's notices (alert:show) and the export result come through the toasts. */}
            <ToastProvider>
              <ErrorBoundary>
                <Shell />
              </ErrorBoundary>
            </ToastProvider>
          </ShellBridge>
        </BridgeProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)

// The first render waits for document.fonts.ready. Blink settles it in a task posted by the layout
// that follows the load event, and that task runs a whole style and layout pass first
// (FontFaceSetDocument::FireDoneEventIfPossible). Rendered before it, the shell paid that pass —
// the first text layout, 20 to 30 ms in WebView2 — between its first commit and the effects that
// send ui:ready, so the library waited for it. After it, the pass runs on an empty page, and the
// layout comes later. The wait is a task or two; the timer covers a promise that does not settle
// soon.
let started = false
function start() {
  if (started) return
  started = true
  if (demo) void demo.then(render, render)
  else render()
}
void document.fonts.ready.then(start, start)
setTimeout(start, 50)

// That first layout runs in a task of its own once the launch's state is on the page. The window
// waits for the GPU channel before its first frame (~45 ms in WebView2, phase 4) with the page idle,
// and a frame that had to lay the page out first would show it that much later. An idle callback
// would come only after that frame (measured). Already laid out, it costs nothing.
const stopWatching = useShell.subscribe((s) => {
  if (!s.booted) return
  stopWatching()
  setTimeout(() => { void document.documentElement.getBoundingClientRect() }, 0)
})
