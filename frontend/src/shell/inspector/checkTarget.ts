import { createContext, useContext } from 'react';
import type { StepEdit } from './inspectorState';

/** The window an automation's points and regions follow ("Relative to a window", D17). */
export type AnchorWindow = { processName: string; windowTitle: string; titleMatchMode: string };

/**
 * Where a check's edits and its screen tools go. A step's check has none: it edits its step, and its
 * points and regions follow its macro's target. An automation's (phase 3, slice 9) edits the
 * automation's trigger, through the steps' field names; its points and regions are on the screen, or
 * on its own window; it captures and crops its image through its own messages; its probes resolve no
 * tokens; and its screen read needs its region (D16).
 */
export interface CheckTarget {
  /** Applies a change of the check's fields, as one change. */
  edit: (edits: StepEdit[]) => boolean;
  /** What the screen tools add to their payloads: not the open macro's target, and the anchor, if any. */
  tools: { absolute: true; anchor?: AnchorWindow };
  /** The macro whose files the reference image is among. */
  profile: string;
  captureImage: () => void;
  /** Choose file…: a picture on disk as the reference image. */
  chooseImage: () => void;
  cropImage: () => void;
}
export const CheckTargetContext = createContext<CheckTarget | null>(null);
export const useCheckTarget = () => useContext(CheckTargetContext);
