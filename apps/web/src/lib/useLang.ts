'use client';
import { useEffect, useState } from 'react';

export type Lang = 'en' | 'zh';

const STORAGE_KEY = 'agon-lang';
const CHANGE_EVENT = 'agon-lang-change';

export function getInitialLang(): Lang {
  return 'en';
}

export function readStoredLang(value: string | null | undefined): Lang {
  return value === 'zh' ? 'zh' : 'en';
}

function readLangFromStorage(): Lang {
  if (typeof window === 'undefined') return getInitialLang();
  return readStoredLang(localStorage.getItem(STORAGE_KEY));
}

export function useLang(): [Lang, () => void] {
  const [lang, setLang] = useState<Lang>(getInitialLang);

  useEffect(() => {
    const sync = () => setLang(readLangFromStorage());
    sync();
    window.addEventListener(CHANGE_EVENT, sync);
    return () => window.removeEventListener(CHANGE_EVENT, sync);
  }, []);

  function toggle() {
    const next: Lang = lang === 'en' ? 'zh' : 'en';
    localStorage.setItem(STORAGE_KEY, next);
    setLang(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return [lang, toggle];
}
