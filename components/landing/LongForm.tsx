import { Eyebrow, Split } from './Split';
import { LongFormVisual } from './LongFormVisual';

const SPECS = [
  { k: 'Limit', v: '50,000 characters per render' },
  { k: 'Split', v: 'At sentence boundaries, any script' },
  { k: 'Render', v: 'Chunks in parallel' },
  { k: 'Output', v: 'One seamless MP3' },
];

export function LongForm() {
  return (
    <section className="sec longform" id="long-form" aria-labelledby="long-title">
      <div className="wrap">
        <div className="lf-top">
          <div className="lf-head">
            <Eyebrow>Long-form</Eyebrow>
            <h2 className="h2" id="long-title" data-split>
              <Split>
                Chapters, not <em>snippets.</em>
              </Split>
            </h2>
            <p className="lede" data-reveal>
              Paste an entire chapter, lecture or report. Magalar cuts it at sentence boundaries, renders every chunk at
              the same time and joins them back into a single file, so there is nothing to splice by hand.
            </p>
          </div>
          <div className="lf-stat" data-reveal>
            <p className="lf-num">
              <span data-count="50000">50,000</span>
            </p>
            <p className="lf-num-label">characters in a single render</p>
          </div>
        </div>

        <div data-reveal>
          <LongFormVisual />
        </div>

        <dl className="lf-specs">
          {SPECS.map((s) => (
            <div key={s.k} data-reveal>
              <dt>{s.k}</dt>
              <dd>{s.v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
