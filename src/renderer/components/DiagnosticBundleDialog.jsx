import * as React from "react";
import { createPortal } from "react-dom";
import { UI } from "./ui";

const { useEffect, useRef, useState } = React;
const h = React.createElement;

function errorMessage(error) {
  return error && error.message ? error.message : String(error || "Bordeaux could not create the diagnostic preview.");
}

export function DiagnosticBundleDialog({ getProject, targetSelector = ".toolbar .tb-right", renderKey, onOpen }) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState("idle");
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [toolbarTarget, setToolbarTarget] = useState(null);
  const closeRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    setToolbarTarget(targetSelector ? document.querySelector(targetSelector) : null);
  }, [targetSelector, renderKey]);

  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    dialog.showModal();
    closeRef.current && closeRef.current.focus();
    return () => dialog.close();
  }, [open]);

  const desktopAvailable = Boolean(window.bordeauxAPI && typeof window.bordeauxAPI.previewBetaDiagnostic === "function");
  const busy = phase === "generating" || phase === "saving";
  const openDialog = () => {
    onOpen?.();
    setOpen(true);
    setPhase("idle");
    setPreview(null);
    setError("");
  };
  const generatePreview = async () => {
    if (!desktopAvailable) return;
    setPhase("generating");
    setError("");
    try {
      const next = await window.bordeauxAPI.previewBetaDiagnostic(getProject());
      if (!next || typeof next.previewId !== "string" || typeof next.contents !== "string") throw new Error("Bordeaux returned an invalid diagnostic preview.");
      setPreview(next);
      setPhase("preview");
    } catch (failure) {
      setPhase("idle");
      setError(errorMessage(failure));
    }
  };
  const savePreview = async () => {
    if (!preview || !window.bordeauxAPI || typeof window.bordeauxAPI.saveBetaDiagnostic !== "function") return;
    setPhase("saving");
    setError("");
    try {
      const result = await window.bordeauxAPI.saveBetaDiagnostic(preview.previewId);
      setPhase(result && result.saved ? "saved" : "cancelled");
    } catch (failure) {
      setPhase("preview");
      setError(errorMessage(failure));
    }
  };

  const trigger = h("button", { className: "robot-push-trigger robot-push-trigger-diagnostics", type: "button", title: "Diagnostics", "aria-label": "Diagnostics", onClick: openDialog, disabled: !desktopAvailable },
    h(UI.Icon, { name: "info", size: 15 }));

  return h(React.Fragment, null,
    toolbarTarget ? createPortal(trigger, toolbarTarget) : null,
    open && h("dialog", { ref: dialogRef, className: "robot-push-dialog robot-diagnostics", "aria-labelledby": "beta-diagnostic-title",
      onCancel: (event) => { event.preventDefault(); if (!busy) setOpen(false); },
      onClick: (event) => {
        if (event.target !== dialogRef.current || busy) return;
        const bounds = dialogRef.current.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setOpen(false);
      } },
        h("header", null,
          h("div", null, h("h2", { id: "beta-diagnostic-title" }, "Diagnostic bundle")),
          h("button", { ref: closeRef, className: "robot-push-close", type: "button", "aria-label": "Close diagnostic bundle", disabled: busy, onClick: () => setOpen(false) }, "×")),
        h("p", { className: "robot-push-intro" }, "Preview and save a local support file. Nothing is sent automatically."),
        error && h("div", { className: "robot-push-alert", role: "alert" }, error),
        !desktopAvailable && h("div", { className: "robot-push-section" },
          h("h3", null, "Desktop app required"),
          h("p", null, "Diagnostic bundles are available only in the Bordeaux desktop app, where the preview and save capability can remain local.")),
        desktopAvailable && phase === "idle" && h("div", { className: "robot-push-section" },
          h("h3", null, "Review before saving"),
          h("p", null, "Includes app, system, field, command, export, routine, and robot acknowledgement details. Review the redacted JSON before saving."),
          h("div", { className: "robot-push-actions" }, h("button", { className: "primary", type: "button", onClick: generatePreview }, "Generate preview"))),
        phase === "generating" && h("div", { className: "robot-push-status", role: "status" },
          h("span", { className: "robot-push-spinner" }), h("strong", null, "Building the local diagnostic preview…")),
        preview && ["preview", "saving", "saved", "cancelled"].includes(phase) && h("div", { className: "robot-push-section" },
          h("h3", null, "Exact bundle preview"),
          h("textarea", {
            className: "robot-push-details",
            "aria-label": "Read-only beta diagnostic JSON",
            readOnly: true,
            value: preview.contents,
            rows: 18,
            spellCheck: false,
            style: { display: "block", width: "100%", maxHeight: "360px", padding: "12px", resize: "vertical", overflow: "auto", whiteSpace: "pre", fontFamily: "var(--mono)", fontSize: "11px", lineHeight: 1.45, color: "var(--txt)" },
          }),
          phase === "saving" && h("div", { className: "robot-push-status", role: "status" }, h("span", { className: "robot-push-spinner" }), h("strong", null, "Saving the reviewed local bundle…")),
          phase === "saved" && h("div", { className: "robot-push-outcome active", role: "status" }, h("h3", null, "Diagnostic bundle saved"), h("p", null, "The reviewed bytes were written locally. Bordeaux did not transmit them.")),
          phase === "cancelled" && h("div", { className: "robot-push-outcome", role: "status" }, h("h3", null, "Save cancelled"), h("p", null, "No diagnostic file was written. You can choose Save again for this same reviewed preview.")),
          phase !== "saving" && h("div", { className: "robot-push-actions" },
            h("button", { type: "button", onClick: generatePreview }, "Regenerate preview"),
            phase !== "saved" && h("button", { className: "primary", type: "button", onClick: savePreview }, "Save bundle"),
            h("button", { type: "button", onClick: () => setOpen(false) }, "Close"))),
      ),
  );
}
