import { useEffect, useState } from 'react';

/**
 * A control that answers the press at once (rule 2): the choice shows straight away and gives way
 * to the engine's echo when it comes. When the engine refuses and the value does not move, the
 * choice lets go after a second and the control shows the value it has.
 */
export function useAnswered<T>(value: T): [T, (next: T) => void] {
  const [pending, setPending] = useState<{ choice: T; from: T } | null>(null);
  // The value moved: the echo (or another change) is here, and it is what the control shows.
  if (pending && !Object.is(pending.from, value)) setPending(null);
  useEffect(() => {
    if (!pending) return;
    const id = setTimeout(() => setPending(null), 1000);
    return () => clearTimeout(id);
  }, [pending]);
  return [pending ? pending.choice : value, (choice: T) => setPending({ choice, from: value })];
}
