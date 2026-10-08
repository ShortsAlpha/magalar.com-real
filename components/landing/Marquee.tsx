const ITEMS = [
  '23 neural voices',
  'Dialogue studio',
  '50,000 characters',
  'Speed 0.5–2×',
  'DOCX → ZIP',
  'Pitch ±50 Hz',
  'Five accents',
  'Parallel synthesis',
  'Volume ±50%',
  'One seamless MP3',
];

function Group({ hidden = false }: { hidden?: boolean }) {
  return (
    <ul className="marquee-group" aria-hidden={hidden || undefined}>
      {ITEMS.map((t, i) => (
        <li key={t} className={i % 3 === 1 ? 'is-serif' : undefined}>
          <span>{t}</span>
          <i className="marquee-sep" aria-hidden="true" />
        </li>
      ))}
    </ul>
  );
}

export function Marquee() {
  return (
    <section className="marquee" aria-label="Capabilities">
      <div className="marquee-track">
        <Group />
        <Group hidden />
      </div>
    </section>
  );
}
