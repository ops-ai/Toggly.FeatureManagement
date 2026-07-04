declare module '@ops-ai/toggly-local-gates' {
  export interface LocalGate {
    id: string;
    flagKeys: readonly string[];
    isEnabled: () => boolean;
  }

  export type FlagGateIndex = ReadonlyMap<string, string>;

  export function buildFlagGateIndex(gates: readonly LocalGate[]): FlagGateIndex;

  export function isLocalPrerequisiteMet(
    flagKey: string,
    gates: readonly LocalGate[],
    gateIndex: FlagGateIndex
  ): boolean;

  export function applyLocalGate(
    remote: boolean,
    flagKey: string,
    gates: readonly LocalGate[],
    gateIndex: FlagGateIndex
  ): boolean;

  export function applyLocalGatesToMap(
    remoteFlags: Readonly<Record<string, boolean>>,
    gates: readonly LocalGate[],
    gateIndex?: FlagGateIndex
  ): Record<string, boolean>;
}
