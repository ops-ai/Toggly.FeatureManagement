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
export function buildFlagGateIndex(gates: readonly LocalGate[]): FlagGateIndex {
  const index = new Map<string, string>();

  for (const gate of gates) {
    for (const flagKey of gate.flagKeys) {
      const existing = index.get(flagKey);
      if (existing !== undefined && existing !== gate.id) {
        throw new Error(
          `Flag key "${flagKey}" is registered on multiple local gates ("${existing}" and "${gate.id}")`,
        );
      }
      index.set(flagKey, gate.id);
    }
  }

  return index;
}

function findGate(gates: readonly LocalGate[], gateId: string): LocalGate | undefined {
  return gates.find((gate) => gate.id === gateId);
}

/**
 * Returns whether the local prerequisite allows the flag (true when ungated).
 */
export function isLocalPrerequisiteMet(
  flagKey: string,
  gates: readonly LocalGate[],
  gateIndex: FlagGateIndex,
): boolean {
  const gateId = gateIndex.get(flagKey);
  if (gateId === undefined) {
    return true;
  }

  const gate = findGate(gates, gateId);
  return gate?.isEnabled() ?? true;
}

/**
 * Applies the local post-filter to a single remote boolean.
 */
export function applyLocalGate(
  remote: boolean,
  flagKey: string,
  gates: readonly LocalGate[],
  gateIndex: FlagGateIndex,
): boolean {
  if (!remote) {
    return false;
  }

  return isLocalPrerequisiteMet(flagKey, gates, gateIndex);
}

/**
 * Applies local gates to every key in a remote flag map (for bulk/debug use).
 */
export function applyLocalGatesToMap(
  remoteFlags: Readonly<Record<string, boolean>>,
  gates: readonly LocalGate[],
  gateIndex?: FlagGateIndex,
): Record<string, boolean> {
  const index = gateIndex ?? buildFlagGateIndex(gates);
  const effective: Record<string, boolean> = {};

  for (const [flagKey, remote] of Object.entries(remoteFlags)) {
    effective[flagKey] = applyLocalGate(remote, flagKey, gates, index);
  }

  return effective;
}
