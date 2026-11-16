# Create-unit parent picker

Approved by the user: reuse the Assign person unit picker in Create unit.

## Design
Show active units in depth-first hierarchy with indentation, unit name and full breadcrumb path. Search matches the unit or its ancestors. Show the selected full path in the trigger. Keep the Parent unit label, placeholder, required-parent validation and create action unchanged.

## Approaches
Reuse UnitTreeSelect (chosen): identical presentation and interaction without duplicate picker logic. A separate picker or styling the flat Select would duplicate behavior and drift from Assign person.

## Constraints
No new dependencies, server changes or migrations. Preserve existing Assign person test identifiers and the create-unit-parent-select trigger identifier. Regression-test search, hierarchy, inactive-unit exclusion, selection and keyboard interaction.
