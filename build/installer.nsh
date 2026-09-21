!macro customInit
  ; Older Bordeaux clients launch updates without /S. Preserve assisted setup
  ; for manual installs while skipping its pages for an updater handoff.
  ${if} ${isUpdated}
    SetSilent silent
  ${endif}
!macroend
