# Dice

A [layerling extensions](https://github.com/westcoastdigital/layerling-extensions) extension for printable dice.

- **D3, D4, D6, D8, D10, D12, D20**
- **Roll (D&D)**: opposite faces add up to the same total (7 on a D6, 21 on a D20), spread so no corner is all high
  or all low; 1-2-3 counter-clockwise on a D6; odd numbers round one tip of a D10
- **Spin-down (MTG)**: 1 on the bottom face, the highest on top, the numbers climbing in a spiral, each next to the one
  before (the D20 matches a classic MTG spin-down face for face); or snaking round so 1 sits beside 20
- **1, 2, 3 …** or **10, 20, 30 …**, and 0-9 / 00-90 for a D10
- **Embedded** numbers: a second body in its own colour, flush with the faces, for two-colour printing
- **Recessed** numbers: cut into the faces, for painting or a plain print
- **Raised** numbers: standing out of the faces, in their own colour
- Size, number depth, number size, font, and both colours

## Install

Comes with layerling-extensions: *Dice* is under *Extension shapes* in the shape library. Change its options in the
inspector and it rebuilds in place.

To add it to another install, copy this `dice` folder into its `extensions/` folder and reload the page. It needs an
extension host with `apiVersion` 2 or later (mesh parts and bundles in a shape); on an older one it says so, and
*Updates → Update now* fixes that.

## Notes

- **Size** is the height of the die as it sits on the plate. It stands on a face, with the highest number on top.
- A **D3** is a cube numbered 1-3 twice, the usual form of a D3.
- A **D4** has three numbers on each face, one at each corner: the number at the top corner is the roll.
- A **D10**'s numbers point to the far tip of their face, as on a bought D10.
- **Dot after 6 and 9** only marks a number that would read as another number on the same die upside down: 6 and 9,
  but not 60 and 90 on a D10 (there is no 06 or 09).
- **Embedded** gives a bundle of two bodies: *D20 body* with the numbers cut in, and *Numbers* filling the cuts.
  Export as 3MF and give each body its filament in the slicer.
- The edges are sharp. For rounded edges, ungroup the body and use layerling's edge tools on it before grouping again,
  or intersect it with a slightly smaller sphere.

## Files

- `index.js`: the options, the numbering and the parts handed to layerling
- `solids.js`: the polyhedra, face geometry and the numbering paths