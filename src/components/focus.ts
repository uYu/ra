let restoringFocus = false;

export function isRestoringFocus() {
  return restoringFocus;
}

export function restoreDialogFocus(element: HTMLElement | null) {
  if (!element?.isConnected) return;
  restoringFocus = true;
  try {
    element.focus({ preventScroll: true });
  } finally {
    restoringFocus = false;
  }
}
