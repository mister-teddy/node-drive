import { atom } from 'jotai';

// Atoms for Uppy UI state
export const isDraggingOverAtom = atom(false);
export const hasFilesAtom = atom(false);
export const filePickerTriggerAtom = atom<(() => void) | null>(null);

// Derived atom for showing dashboard
export const showDashboardAtom = atom((get) => {
  const hasFiles = get(hasFilesAtom);
  const isDraggingOver = get(isDraggingOverAtom);
  return hasFiles && !isDraggingOver;
});

// Helper to manage drag timeout
let dragTimeout: number | null = null;

export const setIsDraggingOverWithDelay = (setValue: (value: boolean) => void, value: boolean) => {
  if (dragTimeout) clearTimeout(dragTimeout);

  if (value) {
    setValue(true);
  } else {
    dragTimeout = setTimeout(() => {
      setValue(false);
    }, 50);
  }
};
