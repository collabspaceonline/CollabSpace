/** Derive a stable HSL colour from a socket ID string. */
export function cursorColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${((hash % 360) + 360) % 360}, 70%, 60%)`;
}
