/** Repeated selects allow several assignments without keyboard modifiers. */
export default function AssignmentSelect({ value, options, onChange, label }) {
  return <div className="assignment-select">
    {value.map((id, index) => <div key={id} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
      <select className="input" style={{ flex: 1, minWidth: 0 }} aria-label={`${label} ${index + 1}`} value={id} onChange={(event) => onChange(value.map((item, i) => i === index ? event.target.value : item))}>
        {!options.some((option) => option.value === id) && <option value={id}>{id}</option>}
        {options.map((option) => <option key={option.value} value={option.value} disabled={option.value !== id && (option.disabled || value.includes(option.value))}>{option.label}</option>)}
      </select>
      <button type="button" className="btn btn--secondary btn--sm" aria-label={`${label} ${index + 1} ni olib tashlash`} onClick={() => onChange(value.filter((item) => item !== id))}>Olib tashlash</button>
    </div>)}
    <select className="input" aria-label={`${label} qo‘shish`} value="" onChange={(event) => { if (event.target.value) onChange([...value, event.target.value]); }}>
      <option value="">— {label} tanlang —</option>
      {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled || value.includes(option.value)}>{option.label}</option>)}
    </select>
  </div>;
}
