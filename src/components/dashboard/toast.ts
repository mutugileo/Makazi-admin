// Page-script access to the dashboard toast with a tone. DashboardLayout's
// showToast takes an optional third `tone` argument; the shared Window type in
// src/types/makazi.d.ts still declares two, so the call is widened here once.

export type ToastTone = 'success' | 'error' | 'progress';

type ShowToast = (title: string, message: string, tone?: ToastTone) => void;

export function toast(title: string, message: string, tone: ToastTone = 'success'): void {
  const show = window.makaziUi?.showToast as ShowToast | undefined;
  show?.(title, message, tone);
}
