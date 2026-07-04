// The 6 packing SOP steps. Order matters — this drives the checklist UI and
// maps Newton's "Step N" verdicts to the right card.
export const STEPS = [
  {
    id: 1,
    name: "Add filler",
    subtitle: "Add bubble wrap or protective material",
  },
  {
    id: 2,
    name: "Place item in box",
    subtitle: "Put the product into the cardboard box",
  },
  {
    id: 3,
    name: "Insert invoice slip",
    subtitle: "Slip goes in the box; text must match the order",
  },
  {
    id: 4,
    name: "Seal box",
    subtitle: "Seal the box shut with tape",
  },
  {
    id: 5,
    name: "Apply shipping label",
    subtitle: "Stick the label on the outside of the box",
  },
  {
    id: 6,
    name: "Place in delivery bin",
    subtitle: "Put the sealed box into the delivery bin",
  },
];

export const BACKEND = "http://localhost:8787";
