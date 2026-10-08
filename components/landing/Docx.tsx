import { FileArchive, FileAudio, FileImage, FileText } from 'lucide-react';
import { Eyebrow, Split } from './Split';
import { Pipeline } from './Pipeline';

const TREE = [
  { name: '01.mp3', kind: 'audio', note: 'Scene 1 · audio' },
  { name: '01.srt', kind: 'subs', note: 'Scene 1 · subtitles' },
  { name: '01.vtt', kind: 'subs', note: 'Scene 1 · subtitles' },
  { name: '01_1.png', kind: 'image', note: 'Scene 1 · image 1' },
  { name: '02.mp3', kind: 'audio', note: 'Scene 2 · audio' },
  { name: '02.srt', kind: 'subs', note: 'Scene 2 · subtitles' },
  { name: '02.vtt', kind: 'subs', note: 'Scene 2 · subtitles' },
  { name: '03.mp3', kind: 'audio', note: 'Scene 3 · audio' },
  { name: '03_1.jpg', kind: 'image', note: 'Scene 3 · image 1' },
] as const;

export function Docx() {
  return (
    <section className="sec inv docx" id="docx" aria-labelledby="docx-title">
      <div className="wrap">
        <header className="sec-head">
          <Eyebrow num="04">DOCX Automator</Eyebrow>
          <h2 className="h2" id="docx-title" data-split>
            <Split>
              Drop in scripts. Get back <em>finished</em> audio.
            </Split>
          </h2>
          <p className="lede" data-reveal>
            Built for video, e-learning and slideshow production. Queue one or many .docx scripts: every scene is
            voiced and subtitled, every embedded image is pulled out, and each document returns as a tidy, numbered
            ZIP that also waits in your library.
          </p>
        </header>

        <div data-reveal>
          <Pipeline />
        </div>

        <div className="docx-grid">
          <figure className="panel" data-reveal>
            <figcaption className="panel-cap">
              <span>In</span> module-01.docx
            </figcaption>
            <div className="docpage" aria-label="Example script layout">
              <p className="dp-scene">Scene 1</p>
              <p className="dp-skip">
                <span>Editor note:</span> keep the intro under a minute.
              </p>
              <p className="dp-key">Spoken script:</p>
              <p className="dp-voice">
                Welcome to module one. Over the next few minutes we will set up your workspace and record a first take.
              </p>
              <div className="dp-img" aria-hidden="true">
                <span>image</span>
              </div>
              <p className="dp-scene">Scene 2</p>
              <p className="dp-key">Spoken script:</p>
              <p className="dp-voice">Start with the toolbar at the top of the screen…</p>
            </div>
            <p className="panel-note">
              Each “Scene N” starts a new scene. Only the narration after “Spoken script:” is voiced; notes and visual
              suggestions are skipped.
            </p>
          </figure>

          <figure className="panel" data-reveal>
            <figcaption className="panel-cap">
              <span>Out</span> module-01.zip
            </figcaption>
            <div className="tree">
              <p className="tree-root">
                <FileArchive size={16} strokeWidth={1.5} aria-hidden="true" />
                <b>module-01.zip</b>
              </p>
              <ul aria-label="Files in module-01.zip">
                {TREE.map((f, i) => (
                  <li key={f.name}>
                    <span className="tree-branch" aria-hidden="true">
                      {i === TREE.length - 1 ? '└─' : '├─'}
                    </span>
                    {f.kind === 'audio' ? (
                      <FileAudio size={15} strokeWidth={1.5} aria-hidden="true" />
                    ) : f.kind === 'subs' ? (
                      <FileText size={15} strokeWidth={1.5} aria-hidden="true" />
                    ) : (
                      <FileImage size={15} strokeWidth={1.5} aria-hidden="true" />
                    )}
                    <span className="tree-name">{f.name}</span>
                    <span className="tree-note">{f.note}</span>
                  </li>
                ))}
                <li className="tree-more" aria-label="and more">
                  <span className="tree-branch" aria-hidden="true">
                    {'  '}
                  </span>
                  <span className="tree-name">…</span>
                </li>
              </ul>
            </div>
            <p className="panel-note">
              Audio and its SRT and VTT subtitles are numbered by scene. Images keep their scene number plus an index,
              so files drop straight onto a timeline or a slide deck in order.
            </p>
          </figure>
        </div>
      </div>
    </section>
  );
}
