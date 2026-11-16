# Add sub-unit from the organization tree

Requested by the user: hovering a unit card in the organization tree (e.g. "QC Section") shows a "+ Add unit" button below the card; the admin clicks it and sets the new unit's name.

## Intent
Creating a sub-unit today means leaving the tree for the page-header "Create unit" dialog and picking the parent again. The admin is already looking at the parent, so the tree should let them add a child right there.

## Design
- **Button:** each active unit card gets a "+ Add unit" button, centered just below the card's bottom edge.
- **When it shows:** while the pointer is over that card or the button, while keyboard focus is inside the card, and while its popover is open. Hovering a child card does not reveal the parent's button.
- **No layout shift:** the button is out of flow, so revealing it never moves cards or connector lines. On units with children it sits on top of the connector stem with a solid background.
- **Popover:** clicking opens a small popover anchored to the button, titled "New unit under {parent name}", with one "Unit name" field (focused on open) and Create / Cancel.
- **Keys:** Enter creates, Esc cancels. Create is disabled while the name is blank or a save is running.
- **Save:** calls the existing `createOrganizationUnit({ name, parentId })` with the hovered unit as parent. On success the popover closes, the field clears, the parent branch expands if it was collapsed, and the page refreshes so the new card appears.
- **Errors:** a failure (e.g. "Name must be unique among sibling units") shows inside the popover as an alert, and the typed name is kept.
- **Touch and narrow cards:** there is no hover, so the "⋯" menu gets an "Add unit" item that opens the same popover.

## Approaches
- **Small popover at the button (chosen by the user):** one field, in place, nothing in the tree moves, errors have a home.
- **Draft card in the tree:** most direct feel, but the tree shifts while typing and it touches the connector-line layout; most work and risk.
- **Existing Create unit dialog with parent pre-filled:** least new code, but a full dialog and a redundant parent picker for a one-field job.

## Non-goals
- No change to the page-header "Create unit" dialog.
- No server, schema or migration changes, and no new dependencies.
- No setting of manager, sharing or solution flags at creation; new units get today's defaults.
- No adding of root units from the tree.

## Constraints
- Keep existing tree test identifiers and the connector layout intact.
- Same permissions as the existing create action; the tree adds no new check.
- Follow the sibling pattern: a presentational view that renders with `renderToStaticMarkup`, wrapped by a stateful component.

## Left to the builder
- Component and file naming, test identifiers for the new button, popover, input and error.
- How the button is positioned and how hover is bridged between card and button.
- Regression tests: view states (empty, typed, saving, error), tree wiring (button per active unit, "⋯" item), and that existing tree tests still pass. Run `npm run check`.
