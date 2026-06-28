// On/off checkbox. Its own component so every boolean setting renders identically
// and can be restyled in one place later.
export function Toggle({ checked, onChange }) {
  return <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />;
}
