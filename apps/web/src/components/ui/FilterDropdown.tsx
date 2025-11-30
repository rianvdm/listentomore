// Dropdown component for filtering data
// Works with form submission for SSR, with optional auto-submit on change

interface FilterDropdownProps {
  label: string;
  id: string;
  name: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  autoSubmit?: boolean;
}

export function FilterDropdown({
  label,
  id,
  name,
  value,
  options,
  autoSubmit = false,
}: FilterDropdownProps) {
  return (
    <div class="filter-container">
      <label class="filter-label" for={id}>
        {label}
      </label>
      <select
        id={id}
        name={name}
        class="select"
        {...(autoSubmit && { onchange: 'this.form.submit()' })}
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            selected={option.value === value}
          >
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export default FilterDropdown;
