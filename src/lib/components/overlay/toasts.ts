export type ToastKind = "info" | "success" | "warn" | "error";

export interface OverlayToast {
  id: string;
  kind: ToastKind;
  message: string;
}