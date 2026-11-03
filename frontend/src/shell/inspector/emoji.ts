import type { ComponentProps } from 'react';
import type EmojiPicker from 'emoji-picker-react';
import type { Categories } from 'emoji-picker-react';
import { LANG, tn } from '../../i18n';

type EmojiData = ComponentProps<typeof EmojiPicker>['emojiData'];

/**
 * The emoji picker (the macro's icon, the Send Text's Emoji tab), loaded when first pointed at. The
 * picker carries its emoji names in English, and its search reads them: the pt-BR build brings the
 * package's Portuguese names along (its emojis-pt data, a chunk of its own), so a search for
 * "coração" finds the heart. The en-US build loads the picker alone. The data is the package's .json
 * (its extensionless path resolves, for tsc, to a .ts source the app's settings do not compile).
 */
export const loadEmojiPicker = () => Promise.all([
  import('emoji-picker-react'),
  LANG === 'pt-BR' ? import('emoji-picker-react/dist/data/emojis-pt.json').then((m) => m.default as unknown as EmojiData) : undefined,
]).then(([module, emojiData]) => ({ module, emojiData }));

/**
 * The picker's categories, in its own order, with their titles from the catalog (the picker writes
 * them in English). Custom emojis are none, so that category is left out. The enum comes from the
 * picker's module once it is in (a type import here: nothing of the picker loads with the panel).
 */
export function emojiCategories(c: typeof Categories) {
  const names = tn('macroSettings.info.emojiCategories');
  return [
    { category: c.SUGGESTED, name: names.suggested },
    { category: c.SMILEYS_PEOPLE, name: names.smileysPeople },
    { category: c.ANIMALS_NATURE, name: names.animalsNature },
    { category: c.FOOD_DRINK, name: names.foodDrink },
    { category: c.TRAVEL_PLACES, name: names.travelPlaces },
    { category: c.ACTIVITIES, name: names.activities },
    { category: c.OBJECTS, name: names.objects },
    { category: c.SYMBOLS, name: names.symbols },
    { category: c.FLAGS, name: names.flags },
  ];
}
