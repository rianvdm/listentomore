// Loading spinner component for indicating loading states

interface LoadingSpinnerProps {
  text?: string;
  size?: 'small' | 'medium' | 'large';
}

const sizeMap = {
  small: '1rem',
  medium: '1.5rem',
  large: '2rem',
};

export function LoadingSpinner({ text = 'Loading...', size = 'medium' }: LoadingSpinnerProps) {
  return (
    <div class="loading-container">
      <span
        class="spinner"
        style={{ fontSize: sizeMap[size] }}
        role="status"
        aria-label="Loading"
      >
        ⟳
      </span>
      {text && <span class="loading-text">{text}</span>}
    </div>
  );
}

export default LoadingSpinner;
