capability preserves that command's controller, feedforwards, events, and requirements. An Aquitaine
Command node still uses the fire-and-continue lifecycle above: make such an auto a deliberate
terminal action or gate later motion through team-owned completion state. Converting its trajectory
into `BordeauxSample` is not currently lossless because the Bordeaux sample model does not retain
module force/feedforward data. The canonical
[path tools and Aquitaine guide](../../java/examples/hardware/path-tools-and-aquitaine.md) documents
the supported wrapping patterns and ownership rules.

## Required failure tests

Test every generator with every start state its contract supports. A moving-start generator needs
valid moving-context and continuity tests; an intentionally stopped-only generator must reject
nontrivial motion. Also cover field edges, obstacle clearance, maximum sample count, timeout,
exception, NaN, duplicate time, backward distance, excessive linear/angular/centripetal dynamics,
fallback, safe stop, and interruption. Exercise every Aquitaine decision branch and verify that
commands requiring the drivetrain do not accidentally interrupt an active follower.

The [Java example gallery](../../java/examples/README.md) links the containment tests and the complete
Aquitaine lifecycle. The [template robot](../../examples/bordeaux-template-robot/README.md) catalogs a
generator but intentionally does not claim to run it without real robot limits, fused state, field
validators, and a follower.
