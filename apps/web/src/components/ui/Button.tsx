// Button component with variants and sizes

import type { Child } from 'hono/jsx';

interface ButtonProps {
  children: Child;
  type?: 'button' | 'submit' | 'reset';
  variant?: 'primary' | 'secondary';
  size?: 'small' | 'medium' | 'large';
  disabled?: boolean;
  class?: string;
}

export function Button({
  children,
  type = 'button',
  variant = 'primary',
  size = 'medium',
  disabled = false,
  class: className,
}: ButtonProps) {
  const classes = [
    'button',
    variant === 'secondary' && 'button--secondary',
    size === 'small' && 'button--small',
    size === 'large' && 'button--large',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type={type} class={classes} disabled={disabled}>
      {children}
    </button>
  );
}

export default Button;
