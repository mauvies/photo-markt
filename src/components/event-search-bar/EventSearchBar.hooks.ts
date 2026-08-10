'use client';

import { useCallback, useRef, useState } from 'react';
import type { ActivityOption } from './EventSearchBar.types';

/**
 * Activity field state for the search bar's filter surfaces.
 *
 * This is a SELECT, not a combobox: the field offers a fixed list of
 * activities and the only way to set one is to pick it. It used to be a
 * typeahead, which bought nothing (the list is short and fully visible) and
 * cost a whole class of dead ends — free text that matched no option, a shake
 * animation to reject it, and a `validate()` step that could silently abort a
 * search on submit. With no text input, "invalid" is unreachable by
 * construction, so none of that exists any more.
 */
export function useActivitySelect(initialActivity: string, sortedActivities: ActivityOption[]) {
  const [selectedValue, setSelectedValue] = useState(initialActivity || '');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedLabel = sortedActivities.find((a) => a.value === selectedValue)?.label ?? '';

  const select = useCallback((opt: ActivityOption) => {
    setSelectedValue(opt.value);
    setOpen(false);
  }, []);

  const clear = useCallback(() => {
    setSelectedValue('');
    setOpen(false);
  }, []);

  const toggle = useCallback(() => setOpen((o) => !o), []);

  return {
    options: sortedActivities,
    selectedValue,
    selectedLabel,
    open,
    setOpen,
    toggle,
    containerRef,
    select,
    clear,
  };
}
