/// Device-local gate that ANDs with worker-evaluated flag booleans at read time.
class LocalGate {
  const LocalGate({
    required this.id,
    required this.flagKeys,
    required this.isEnabled,
  });

  final String id;
  final List<String> flagKeys;
  final bool Function() isEnabled;
}

typedef FlagGateIndex = Map<String, String>;

/// Builds a flag-key → gate-id index. Throws if a flag key appears in more than one gate.
FlagGateIndex buildFlagGateIndex(List<LocalGate> gates) {
  final index = <String, String>{};

  for (final gate in gates) {
    for (final flagKey in gate.flagKeys) {
      final existing = index[flagKey];
      if (existing != null && existing != gate.id) {
        throw ArgumentError(
          'Flag key "$flagKey" is registered on multiple local gates ("$existing" and "${gate.id}")',
        );
      }
      index[flagKey] = gate.id;
    }
  }

  return index;
}

LocalGate? _findGate(List<LocalGate> gates, String gateId) {
  for (final gate in gates) {
    if (gate.id == gateId) {
      return gate;
    }
  }
  return null;
}

/// Returns whether the local prerequisite allows the flag (true when ungated).
bool isLocalPrerequisiteMet(
  String flagKey,
  List<LocalGate> gates,
  FlagGateIndex gateIndex,
) {
  final gateId = gateIndex[flagKey];
  if (gateId == null) {
    return true;
  }

  final gate = _findGate(gates, gateId);
  return gate?.isEnabled() ?? true;
}

/// Applies the local post-filter to a single remote boolean.
bool applyLocalGate(
  bool remote,
  String flagKey,
  List<LocalGate> gates,
  FlagGateIndex gateIndex,
) {
  if (!remote) {
    return false;
  }

  return isLocalPrerequisiteMet(flagKey, gates, gateIndex);
}

/// Applies local gates to every key in a remote flag map (for bulk/debug use).
Map<String, bool> applyLocalGatesToMap(
  Map<String, bool> remoteFlags,
  List<LocalGate> gates, [
  FlagGateIndex? gateIndex,
]) {
  final index = gateIndex ?? buildFlagGateIndex(gates);
  final effective = <String, bool>{};

  remoteFlags.forEach((flagKey, remote) {
    effective[flagKey] = applyLocalGate(remote, flagKey, gates, index);
  });

  return effective;
}
