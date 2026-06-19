'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { ActivityOption } from './EventSearchBar.types';

export function useActivityCombobox(initialActivity: string, sortedActivities: ActivityOption[]) {
  const initialLabel = sortedActivities.find((a) => a.value === initialActivity)?.label ?? '';
  const [inputValue, setInputValue] = useState(initialLabel);
  const [selectedValue, setSelectedValue] = useState(initialActivity || '');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!inputValue.trim()) return sortedActivities;
    return sortedActivities.filter((a) => a.label.toLowerCase().includes(inputValue.toLowerCase()));
  }, [inputValue, sortedActivities]);

  const select = useCallback((opt: ActivityOption) => {
    setInputValue(opt.label);
    setSelectedValue(opt.value);
    setError(false);
    setOpen(false);
  }, []);

  const clear = useCallback(() => {
    setInputValue('');
    setSelectedValue('');
    setError(false);
  }, []);

  const validate = useCallback((): string | null => {
    if (!inputValue.trim()) return '';
    const match = sortedActivities.find((a) => a.label.toLowerCase() === inputValue.toLowerCase());
    if (!match) {
      setError(true);
      setTimeout(() => setError(false), 600);
      return null;
    }
    return match.value;
  }, [inputValue, sortedActivities]);

  return {
    inputValue,
    setInputValue,
    selectedValue,
    open,
    setOpen,
    error,
    filtered,
    containerRef,
    select,
    clear,
    validate,
  };
}
