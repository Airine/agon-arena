'use client';
import { useEffect, useState } from 'react';

export type Lang = 'en' | 'zh';

const STORAGE_KEY = 'agon-lang';
const CHANGE_EVENT = 'agon-lang-change';

export function useLang(): [Lang, () => void] {
  const [lang, setLang] = useState<Lang>(() => {
    if (typeof window === 'undefined') return 'en';
    return (localStorage.getItem(STORAGE_KEY) as Lang) ?? 'en';
  });

  useEffect(() => {
    const sync = () => setLang((localStorage.getItem(STORAGE_KEY) as Lang) ?? 'en');
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
