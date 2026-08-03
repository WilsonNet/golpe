/**
 * Shared units of measurement.
 *
 * A separate module because both `Physics` and `Melee` need them, and neither
 * can import the other without a cycle — this file imports nothing, so
 * anything in the simulation can pull `MS_PER_SECOND` from here without
 * creating one. `Physics` re-exports them so client code that already imports
 * from `simulation/Physics` keeps one entry point.
 */
export const MS_PER_SECOND = 1000;
export const SECONDS_PER_MINUTE = 60;
