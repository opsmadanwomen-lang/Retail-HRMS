// Adapted from shadcn/ui's toast primitive (single-file, dependency-free store).
import * as React from "react";

const TOAST_LIMIT = 5;
const TOAST_REMOVE_DELAY = 4000;

export type ToastVariant = "default" | "destructive" | "success";

export interface ToastItem {
  id: string;
  title?: string;
  description?: string;
  variant?: ToastVariant;
}

type Action =
  | { type: "ADD_TOAST"; toast: ToastItem }
  | { type: "REMOVE_TOAST"; id: string };

let count = 0;
function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
}

interface State {
  toasts: ToastItem[];
}

const listeners: Array<(state: State) => void> = [];
let memoryState: State = { toasts: [] };

function dispatch(action: Action) {
  switch (action.type) {
    case "ADD_TOAST":
      memoryState = { toasts: [action.toast, ...memoryState.toasts].slice(0, TOAST_LIMIT) };
      break;
    case "REMOVE_TOAST":
      memoryState = { toasts: memoryState.toasts.filter((t) => t.id !== action.id) };
      break;
  }
  listeners.forEach((listener) => listener(memoryState));
}

export function toast(props: Omit<ToastItem, "id">) {
  const id = genId();
  dispatch({ type: "ADD_TOAST", toast: { ...props, id } });
  setTimeout(() => dispatch({ type: "REMOVE_TOAST", id }), TOAST_REMOVE_DELAY);
  return id;
}

export function useToast() {
  const [state, setState] = React.useState<State>(memoryState);

  React.useEffect(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) listeners.splice(index, 1);
    };
  }, []);

  return { toasts: state.toasts, toast, dismiss: (id: string) => dispatch({ type: "REMOVE_TOAST", id }) };
}
