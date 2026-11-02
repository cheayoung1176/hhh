'use client';

import { useEffect, useState } from 'react';
import Icon from './Icon';

export default function ThemeToggle({ className = '' }) {
  const [theme, setTheme] = useState('light');

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  }, []);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch (e) {}
    setTheme(next);
  }

  return (
    <button
      type="button"
      className={`ib theme-toggle ${className}`}
      onClick={toggle}
      aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
      title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
    >
      <Icon name={theme === 'dark' ? 'light_mode' : 'dark_mode'} />
    </button>
  );
}
