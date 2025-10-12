import { makeAutoObservable } from 'mobx';

class UppyStore {
  isDraggingOver = false;
  hasFiles = false;
  filePickerTrigger: (() => void) | null = null;
  private dragTimeout: number | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  setFilePickerTrigger(trigger: () => void) {
    this.filePickerTrigger = trigger;
  }

  setIsDraggingOver(value: boolean) {
    if (this.dragTimeout) clearTimeout(this.dragTimeout);

    if (value) {
      this.isDraggingOver = true;
    } else {
      this.dragTimeout = setTimeout(() => {
        this.isDraggingOver = false;
      }, 50);
    }
  }

  setHasFiles(value: boolean) {
    this.hasFiles = value;
  }

  openFilePicker() {
    if (this.filePickerTrigger) {
      this.filePickerTrigger();
    }
  }

  get showDashboard() {
    return this.hasFiles && !this.isDraggingOver;
  }
}

export const uppyStore = new UppyStore();
