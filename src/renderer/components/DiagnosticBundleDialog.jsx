import * as React from "react";
import { createPortal } from "react-dom";

const { useEffect, useRef, useState } = React;
const h = React.createElement;

function errorMessage(error) {
  return error && error.message ? error.message : String(error || "Bordeaux could not create the diagnostic preview.");
}

export function DiagnosticBundleDialog({ getProject }) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState("idle");
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [toolbarTarget, setToolbarTarget] = useState(null);
  const closeRef = useRef(null);

  useEffect(() => {
    setToolbarTarget(document.querySelector(".toolbar .tb-right"));
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    closeRef.current && closeRef.current.focus();
    const onKey = (event) => {
      if (event.key === "Escape" && phase !== "generating" && phase !== "saving") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, phase]);

  const desktopAvailable = Boolean(window.bordeauxAPI && typeof window.bordeauxAPI.previewBetaDiagnostic === "function");
  const busy = phase === "generating" || phase === "saving";
  const openDialog = () => {
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

  const trigger = h("button", { className: "robot-push-trigger", type: "button", onClick: openDialog, disabled: !desktopAvailable },
    h("span", { "aria-hidden": true }, "⌁"), " Diagnostics");

  return h(React.Fragment, null,
    toolbarTarget ? createPortal(trigger, toolbarTarget) : null,
    open && h("div", { className: "robot-push-backdrop", onMouseDown: (event) => {
      if (event.target === event.currentTarget && !busy) setOpen(false);
    } },
      h("section", { className: "robot-push-dialog", role: "dialog", "aria-modal": true, "aria-labelledby": "beta-diagnostic-title" },
        h("header", null,
          h("div", null, h("p", { className: "robot-push-eyebrow" }, "Explicit beta support bundle"), h("h2", { id: "beta-diagnostic-title" }, "Create Diagnostic Bundle")),
          h("button", { ref: closeRef, className: "robot-push-close", type: "button", "aria-label": "Close diagnostic bundle", disabled: busy, onClick: () => setOpen(false) }, "×")),
        h("p", { className: "robot-push-intro" }, "Bordeaux builds this bundle locally for you to inspect. It does not send telemetry, contact the robot, or transmit the bundle; Save only opens your local file chooser."),
        error && h("div", { className: "robot-push-alert", role: "alert" }, error),
        !desktopAvailable && h("div", { className: "robot-push-section" },
          h("h3", null, "Desktop app required"),
          h("p", null, "Diagnostic bundles are available only in the Bordeaux desktop app, where the preview and save capability can remain local.")),
        desktopAvailable && phase === "idle" && h("div", { className: "robot-push-section" },
          h("h3", null, "Review before saving"),
          h("p", null, "Generate a redacted JSON preview first. The bundle contains only Bordeaux version, operating-system, field, catalog, export, routine-preflight, and reduced robot-acknowledgement information."),
          h("div", { className: "robot-push-actions" }, h("button", { className: "primary", type: "button", onClick: generatePreview }, "Generate Preview"))),
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
            style: { display: "block", width: "100%", maxHeight: "360px", padding: "12px", resize: "vertical", overflow: "auto", whiteSpace: "pre", fontFamily: "var(--font-mono)", fontSize: "11px", lineHeight: 1.45, color: "#e8edf7" },
          }),
          phase === "saving" && h("div", { className: "robot-push-status", role: "status" }, h("span", { className: "robot-push-spinner" }), h("strong", null, "Saving the reviewed local bundle…")),
          phase === "saved" && h("div", { className: "robot-push-outcome active", role: "status" }, h("h3", null, "Diagnostic bundle saved"), h("p", null, "The reviewed bytes were written locally. Bordeaux did not transmit them.")),
          phase === "cancelled" && h("div", { className: "robot-push-outcome", role: "status" }, h("h3", null, "Save cancelled"), h("p", null, "No diagnostic file was written. You can choose Save again for this same reviewed preview.")),
          phase !== "saving" && h("div", { className: "robot-push-actions" },
            h("button", { type: "button", onClick: generatePreview }, "Regenerate Preview"),
            phase !== "saved" && h("button", { className: "primary", type: "button", onClick: savePreview }, "Save This Bundle"),
            h("button", { type: "button", onClick: () => setOpen(false) }, "Close"))),
      )),
  );
}
