import { Dropdown } from '../elements/Dropdown';
import { Field } from '../elements/Field';

export type Option = { value: string; label: string };

export function FilterDropdown({
  label,
  value,
  options,
  onChange,
  disabled = false,
  allowAny = true,
}: Readonly<{
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
  allowAny?: boolean;
}>) {
  return (
    <Field label={label}>
      <Dropdown value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
        {allowAny && (
          <option value="">
            Any {['CPU', 'GPU', 'RAM'].includes(label) ? label : label.toLowerCase()}
          </option>
        )}
        {value && !options.some(option => option.value === value) && (
          <option value={value}>{value} (not in current options)</option>
        )}
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Dropdown>
    </Field>
  );
}
