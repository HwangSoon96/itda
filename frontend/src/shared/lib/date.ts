export function localToday() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// Open the native calendar when the whole date box is clicked, not only its icon.
export function openDatePicker(input: HTMLInputElement) {
  if (input.disabled || input.readOnly || typeof input.showPicker !== 'function') return
  try {
    input.showPicker()
  } catch {
    // Browsers without user-activation support keep the icon-only behavior.
  }
}
