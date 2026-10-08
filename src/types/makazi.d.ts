export {};

declare global {
  interface Window {
    /** Modal and toast helpers exposed by DashboardLayout for page scripts. */
    makaziUi?: {
      showModal(id: string): void;
      hideModal(id: string): void;
      showToast(title: string, message: string): void;
    };
  }
}
