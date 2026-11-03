import { t } from '../i18n';

/**
 * The name a new macro is born with (plan of languages, §2.4): "Untitled macro" in English, "Macro sem
 * nome" in Portuguese, then "… 2", "… 3" (library/model.ts, freeName). Like Word's "Documento1", it is
 * born in the interface's language and is the user's from then on.
 */
export const UNTITLED_MACRO = t('common.names.untitledMacro');

// Both languages' names, whatever this build's: a macro created before a change of language is still
// one the app named. A recognizer, not text on screen.
const UNTITLED_NAME = /^(?:Untitled macro|Macro sem nome)(?: \d+)?$/;

/** A name the app gave a new macro, in either language. */
export const isUntitledName = (name: string): boolean => UNTITLED_NAME.test(name);
