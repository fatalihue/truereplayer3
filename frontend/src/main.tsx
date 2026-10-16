import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyThemeConfig, loadCustomPresets, loadThemeConfig, resolveThemeColors } from './themes'

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
