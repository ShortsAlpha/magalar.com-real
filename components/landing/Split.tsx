import { Children, isValidElement, type CSSProperties, type ReactNode } from 'react';

/**
 * Wraps every word (and every inline element, e.g. <em>) in a mask + inner span so
 * headings can do a word-by-word rise. Rendered on the server: the text is always in the
 * HTML and fully visible; the hidden start state is only applied by <Motion/> on the client
 * to headings that are still below the fold.
 */
export function Split({ children, start = 0 }: { children: ReactNode; start?: number }) {
  let i = start;
  const out: ReactNode[] = [];
  Children.toArray(children).forEach((child, ci) => {
    if (typeof child === 'string' || typeof child === 'number') {
      String(child)
        .split(/(\s+)/)
        .forEach((part, pi) => {
          if (!part) return;
          if (/^\s+$/.test(part)) {
            out.push(' ');
            return;
          }
          out.push(
            <span className="w" key={`${ci}-${pi}`}>
              <span className="wi" style={{ '--i': i++ } as CSSProperties}>
                {part}
              </span>
            </span>,
          );
        });
    } else if (isValidElement(child) && child.type === 'br') {
      out.push(child);
    } else {
      out.push(
        <span className="w" key={`${ci}-el`}>
          <span className="wi" style={{ '--i': i++ } as CSSProperties}>
            {child}
          </span>
        </span>,
      );
    }
  });
  return <>{out}</>;
}

/** Numbered mono eyebrow: "01 —— FEATURES". */
export function Eyebrow({ num, children }: { num?: string; children: ReactNode }) {
  return (
    <p className="eyebrow">
      {num ? <span className="eb-num">{num}</span> : <span className="eb-dot" aria-hidden="true" />}
      <span className="eb-rule" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
