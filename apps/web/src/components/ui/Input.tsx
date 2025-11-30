// Input component for forms

interface InputProps {
  type?: 'text' | 'search' | 'email' | 'password' | 'url';
  name?: string;
  placeholder?: string;
  value?: string;
  required?: boolean;
  autofocus?: boolean;
  class?: string;
  style?: Record<string, string>;
}

export function Input({
  type = 'text',
  name,
  placeholder,
  value,
  required = false,
  autofocus = false,
  class: className,
  style,
}: InputProps) {
  const classes = ['input', className].filter(Boolean).join(' ');

  return (
    <input
      type={type}
      name={name}
      placeholder={placeholder}
      value={value}
      required={required}
      autofocus={autofocus}
      class={classes}
      style={style}
    />
  );
}

export default Input;
