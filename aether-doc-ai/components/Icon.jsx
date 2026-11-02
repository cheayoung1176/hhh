export default function Icon({ name, fill = false, size, className = '' }) {
  return (
    <span
      className={`material-symbols-outlined ${fill ? 'fill' : ''} ${className}`}
      style={size ? { fontSize: size } : undefined}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}
