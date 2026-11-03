// The machine's culture, for the previews of what the engine will type. The engine formats {date}
// and {time} with CultureInfo.CurrentCulture (ActionExecution.TokenCulture): the Windows regional
// format, not the interface language. The WebView2's language follows the interface since the
// language slice (I1), so navigator.language is the interface's; state:init carries the machine's
// name instead (machineCulture). Before it arrives, and in a harness without it, the browser's
// language stands in, as it always did.

let machine: string | null = null;

/** Takes state:init's machineCulture; an empty name (the invariant culture) keeps the stand-in. */
export function setMachineLocale(name: string | null | undefined) {
  if (!name) return;
  try {
    // A .NET name Intl does not know would throw in every preview: check it once here.
    new Intl.DateTimeFormat(name);
    machine = name;
  } catch { /* keep the stand-in */ }
}

/** The locale the engine's {date}/{time} names follow. */
export function machineLocale(): string {
  return machine ?? ((typeof navigator !== 'undefined' && navigator.language) || 'en-US');
}
