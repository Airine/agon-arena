'use client';
import { useEffect, useRef, useState } from 'react';

interface StatCounterProps {
  target: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}

export function StatCounter({
  target,
  prefix = '',
  suffix = '',
  className = '',
}: StatCounterProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [triggered, setTriggered] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setTriggered(true);
          obs.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!triggered || !ref.current) return;
    const duration = 1800;
    let start: number | null = null;
    const el = ref.current;

    function update(ts: number) {
      if (!start) start = ts;
      const t = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = `${prefix}${Math.round(eased * target).toLocaleString()}${suffix}`;
      if (t < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  }, [triggered, target, prefix, suffix]);

  return (
    <span ref={ref} className={className}>
      {prefix}0{suffix}
    </span>
  );
}
