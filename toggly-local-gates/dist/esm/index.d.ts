/**
 * Device-local gate that ANDs with worker-evaluated flag booleans at read time.
 */
export interface LocalGate {
    /** Stable id, e.g. 'apiRedesign' */
    id: string;
    /** Feature flag keys gated by this local prerequisite */
    flagKeys: readonly string[];
    /** Read current device-local state (sync) */
    isEnabled: () => boolean;
}
export type FlagGateIndex = ReadonlyMap<string, string>;
/**
 * Builds a flag-key → gate-id index. Throws if a flag key appears in more than one gate.
 */
export declare function buildFlagGateIndex(gates: readonly LocalGate[]): FlagGateIndex;
/**
 * Returns whether the local prerequisite allows the flag (true when ungated).
 */
export declare function isLocalPrerequisiteMet(flagKey: string, gates: readonly LocalGate[], gateIndex: FlagGateIndex): boolean;
/**
 * Applies the local post-filter to a single remote boolean.
 */
export declare function applyLocalGate(remote: boolean, flagKey: string, gates: readonly LocalGate[], gateIndex: FlagGateIndex): boolean;
/**
 * Applies local gates to every key in a remote flag map (for bulk/debug use).
 */
export declare function applyLocalGatesToMap(remoteFlags: Readonly<Record<string, boolean>>, gates: readonly LocalGate[], gateIndex?: FlagGateIndex): Record<string, boolean>;
