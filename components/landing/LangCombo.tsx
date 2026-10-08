'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Search } from 'lucide-react';
import { LANGUAGE_COUNT } from '@/lib/voices';
import { languagesFrom, type Labels, type Lang } from './catalog';

type Opt = Lang & { group?: string };

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const optsCache = new WeakMap<Labels, Opt[]>();
function allOpts(L: Labels): Opt[] {
  let o = optsCache.get(L);
  if (!o) {
    const { featured, other } = languagesFrom(L);
    o = [
      ...featured.map((l, i) => ({ ...l, group: i === 0 ? 'Featured' : undefined })),
      ...other.map((l, i) => ({ ...l, group: i === 0 ? 'All languages' : undefined })),
    ];
    optsCache.set(L, o);
  }
  return o;
}

function filter(query: string, L: Labels): Opt[] {
  const all = allOpts(L);
  const q = fold(query.trim());
  if (!q) return all;
  const hits = all
    .filter((o) => fold(o.name).includes(q) || fold(o.native).includes(q) || o.code === q)
    .map((o) => ({ ...o, group: undefined }));
  const starts = (o: Opt) => (fold(o.name).startsWith(q) || fold(o.native).startsWith(q) ? 0 : 1);
  return hits.sort((a, b) => starts(a) - starts(b) || a.name.localeCompare(b.name));
}

/**
 * Language picker: a trigger button that opens a searchable listbox
 * (featured languages first). Keyboard: ↑ ↓ Home End Enter Escape, type to filter.
 */
export function LangCombo({
  value,
  onChange,
  labelId,
  labels,
}: {
  value: string;
  onChange: (code: string) => void;
  labelId: string;
  labels: Labels;
}) {
  const uid = useId();
  const listId = `${uid}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const opts = useMemo(() => filter(query, labels), [query, labels]);
  const current = languagesFrom(labels).byCode.get(value);
  const currentNative = current?.native ?? '';

  const openList = () => {
    const i = allOpts(labels).findIndex((o) => o.code === value);
    setQuery('');
    setActive(Math.max(0, i));
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  const choose = (o: Opt | undefined) => {
    if (!o) return;
    onChange(o.code);
    close(true);
  };

  // Focus the search field on open; close on outside pointer.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Keep the active option in view.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = opts.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (n) setActive((a) => (a + 1) % n);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (n) setActive((a) => (a - 1 + n) % n);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(Math.max(0, n - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(opts[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="lc" data-open={open ? '' : undefined}>
      <button
        ref={triggerRef}
        type="button"
        className="lc-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${labelId} ${uid}-val`}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            openList();
          }
        }}
      >
        <span className="lc-val" id={`${uid}-val`}>
          <b>{current?.name ?? value}</b>
          {currentNative ? <span lang={value}>{currentNative}</span> : null}
        </span>
        <span className="lc-count">{current?.voiceCount ?? 0}</span>
        <span className="lc-chev" aria-hidden="true" />
      </button>

      {open ? (
        <div className="lc-pop">
          <div className="lc-search">
            <Search size={15} strokeWidth={1.75} aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-label="Search languages"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={opts[active] ? `${uid}-o-${opts[active].code}` : undefined}
              placeholder={`Search ${LANGUAGE_COUNT} languages`}
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKey}
            />
          </div>
          <ul ref={listRef} id={listId} role="listbox" aria-label="Languages" className="lc-list">
            {opts.length === 0 ? (
              <li className="lc-empty" role="presentation">
                No language matches “{query}”
              </li>
            ) : (
              opts.map((o, i) => (
                <li
                  key={o.code}
                  id={`${uid}-o-${o.code}`}
                  role="option"
                  aria-selected={o.code === value}
                  data-i={i}
                  data-active={i === active ? '' : undefined}
                  data-group={o.group}
                  className="lc-opt"
                  onPointerMove={() => setActive(i)}
                  onClick={() => choose(o)}
                >
                  <span className="lc-name">{o.name}</span>
                  {o.native ? (
                    <span className="lc-native" lang={o.code}>
                      {o.native}
                    </span>
                  ) : null}
                  <span className="lc-n">{o.voiceCount}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
