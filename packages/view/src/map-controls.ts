/** Shared commands and engraved icons; each surface owns placement and event handling. */
export const MAP_CONTROLS = {
  arrange: {
    action: "arrange", attribute: "data-reset-layout", label: "Arrange map", text: "Arrange",
    title: "Restore the automatic reading order. Drag a mark to place it: it snaps into line with its neighbours (Alt places freely); Alt / Option with arrow keys nudges it.",
    path: "M3.5 5.5h6a3.5 3.5 0 0 1 0 7H5M3.5 5.5 6 3M3.5 5.5 6 8"
  },
  zoom: [
    { action: "zoomOut", attribute: "data-zoom-out", label: "Zoom out", title: "Zoom out", path: "M3.5 8h9" },
    { action: "zoomIn", attribute: "data-zoom-in", label: "Zoom in", title: "Zoom in", path: "M3.5 8h9M8 3.5v9" },
    { action: "fit", attribute: "data-fit", label: "Fit map", title: "Fit the whole map", path: "M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" }
  ]
} as const;
