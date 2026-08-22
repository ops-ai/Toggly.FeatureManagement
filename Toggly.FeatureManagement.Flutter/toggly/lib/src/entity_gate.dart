/// Client-side entity-gate evaluation (fail closed).
library entity_gate;

typedef EntityContextMapper = TogglyEntityContext Function(dynamic entity);

class EntityGateRule {
  const EntityGateRule({
    required this.property,
    required this.op,
    required this.value,
    this.type,
  });

  final String property;
  final String op;
  final String value;
  final String? type;

  factory EntityGateRule.fromJson(Map<String, dynamic> json) {
    return EntityGateRule(
      property: json['property']?.toString() ?? '',
      op: json['op']?.toString() ?? '',
      value: json['value']?.toString() ?? '',
      type: json['type']?.toString(),
    );
  }
}

class EntityGate {
  const EntityGate({
    this.requirement = 'all',
    required this.rules,
  });

  final String requirement;
  final List<EntityGateRule> rules;

  factory EntityGate.fromJson(Map<String, dynamic> json) {
    final rawRules = json['rules'];
    final rules = rawRules is List
        ? rawRules
            .whereType<Map>()
            .map((rule) =>
                EntityGateRule.fromJson(Map<String, dynamic>.from(rule)))
            .toList()
        : <EntityGateRule>[];
    return EntityGate(
      requirement: json['requirement']?.toString() ?? 'all',
      rules: rules,
    );
  }
}

class TogglyEntityContext {
  const TogglyEntityContext({
    required this.kind,
    required this.key,
    required this.attributes,
  });

  final String kind;
  final String key;
  final Map<String, dynamic> attributes;
}

final _equalityOps = {'eq', 'neq'};
final _comparisonOps = {'gt', 'gte', 'lt', 'lte'};
final _inOps = {'in'};
final _containsOps = {'contains'};

final Map<String, EntityContextMapper> _contextMappers = {};

bool isEntityGate(dynamic value) {
  if (value is! EntityGate) {
    return false;
  }
  if (value.requirement != 'all' && value.requirement != 'any') {
    return false;
  }
  return true;
}

bool resolveEvaluatedDefinition(
  dynamic value, {
  TogglyEntityContext? context,
  bool defaultValue = false,
}) {
  if (value == null) {
    return defaultValue;
  }
  if (value == true) {
    return true;
  }
  if (value == false) {
    return false;
  }
  if (value is! EntityGate || !isEntityGate(value)) {
    return false;
  }
  if (context == null) {
    return false;
  }
  return applyEntityGate(value, context.attributes);
}

Map<String, bool> toBooleanDefinitions(
  Map<String, dynamic> definitions, {
  TogglyEntityContext? context,
}) {
  return {
    for (final entry in definitions.entries)
      entry.key: resolveEvaluatedDefinition(entry.value, context: context),
  };
}

bool applyEntityGate(EntityGate gate, Map<String, dynamic> attributes) {
  if (gate.rules.isEmpty) {
    return false;
  }
  final requirement = gate.requirement == 'any' ? 'any' : 'all';
  final results = gate.rules.map((rule) => _evaluateRule(rule, attributes));
  return requirement == 'all' ? results.every((v) => v) : results.any((v) => v);
}

void registerContext(String kind, EntityContextMapper mapper) {
  _contextMappers[kind] = mapper;
}

TogglyEntityContext? resolveEntityContext(String kind, dynamic entity) {
  final mapper = _contextMappers[kind];
  if (mapper == null) {
    return null;
  }
  return mapper(entity);
}

TogglyEntityContext? mapEntityContext(
  String kind,
  dynamic entity, [
  EntityContextMapper? mapper,
]) {
  if (mapper != null) {
    return mapper(entity);
  }
  return resolveEntityContext(kind, entity);
}

void clearRegisteredContexts() {
  _contextMappers.clear();
}

TogglyEntityContext? normalizeEntityContext(dynamic context, [String? kind]) {
  if (context == null) {
    return null;
  }
  if (context is TogglyEntityContext) {
    return context;
  }
  if (kind != null) {
    return mapEntityContext(kind, context);
  }
  return null;
}

Map<String, dynamic> parseEvaluatedDefinitions(dynamic raw) {
  if (raw is! Map) {
    return {};
  }
  final result = <String, dynamic>{};
  raw.forEach((key, value) {
    result[key.toString()] = parseDefinitionValue(value);
  });
  return result;
}

dynamic parseDefinitionValue(dynamic value) {
  if (value is bool) {
    return value;
  }
  if (value is Map) {
    final map = Map<String, dynamic>.from(value);
    final gate = tryParseEntityGate(map);
    if (gate != null) {
      return gate;
    }
  }
  return false;
}

EntityGate? tryParseEntityGate(Map<String, dynamic> obj) {
  final rules = obj['rules'];
  if (rules is! List) {
    return null;
  }
  final requirement = obj['requirement'];
  if (requirement != null && requirement != 'all' && requirement != 'any') {
    return null;
  }
  return EntityGate.fromJson(obj);
}

bool evaluateResolvedKeys(
  List<String> featureKeys,
  bool requirementAll,
  bool negate,
  bool Function(String key) isEnabled,
) {
  if (featureKeys.isEmpty) {
    return !negate;
  }
  final result = requirementAll
      ? featureKeys.every(isEnabled)
      : featureKeys.any(isEnabled);
  return negate ? !result : result;
}

bool evaluateStoredFeatureKeys(
  Map<String, dynamic>? features,
  List<String> featureKeys,
  bool requirementAll,
  bool negate,
  bool Function(String key) isEnabled,
) {
  if (featureKeys.isNotEmpty && (features == null || features.isEmpty)) {
    return negate;
  }
  return evaluateResolvedKeys(featureKeys, requirementAll, negate, isEnabled);
}

bool evaluateEvaluatedGate(
  Map<String, dynamic> features,
  List<String> featureKeys, {
  bool requirementAll = true,
  bool negate = false,
  TogglyEntityContext? entityContext,
}) {
  return evaluateStoredFeatureKeys(
    features,
    featureKeys,
    requirementAll,
    negate,
    (key) => resolveEvaluatedDefinition(features[key], context: entityContext),
  );
}

bool _evaluateRule(EntityGateRule rule, Map<String, dynamic> attributes) {
  final actualKey = _findAttributeKey(attributes, rule.property);
  if (actualKey == null) {
    return false;
  }
  final actual = attributes[actualKey];
  final op = rule.op.toLowerCase();
  final valueType = rule.type ?? 'string';

  if (_equalityOps.contains(op)) {
    return _compareEquality(actual, rule.value, op == 'eq');
  }
  if (_comparisonOps.contains(op)) {
    return _compareOrdered(actual, rule.value, valueType, op);
  }
  if (_inOps.contains(op)) {
    return _compareIn(actual, rule.value);
  }
  if (_containsOps.contains(op)) {
    return _compareContains(actual, rule.value, valueType);
  }
  return false;
}

String? _findAttributeKey(Map<String, dynamic> attributes, String property) {
  if (attributes.containsKey(property)) {
    return property;
  }
  final expected = property.toLowerCase();
  for (final key in attributes.keys) {
    if (key.toLowerCase() == expected) {
      return key;
    }
  }
  return null;
}

String _stringifyActual(dynamic actual) {
  if (actual == null) {
    return '';
  }
  if (actual is num && actual == actual.roundToDouble()) {
    return actual.toInt().toString();
  }
  return actual.toString();
}

bool _compareEquality(dynamic actual, String expected, bool shouldEqual) {
  final equal =
      _stringifyActual(actual).toLowerCase() == expected.toLowerCase();
  return shouldEqual ? equal : !equal;
}

bool _compareOrdered(
  dynamic actual,
  String expected,
  String valueType,
  String op,
) {
  if (valueType == 'datetime') {
    final actualDate = _parseDateTime(actual);
    final expectedDate = _parseDateTime(expected);
    if (actualDate == null || expectedDate == null) {
      return false;
    }
    return _compareNumbers(actualDate, expectedDate, op);
  }
  if (valueType != 'number') {
    return false;
  }
  final actualNumber = _parseNumber(actual);
  final expectedNumber = _parseNumber(expected);
  if (actualNumber == null || expectedNumber == null) {
    return false;
  }
  return _compareNumbers(actualNumber, expectedNumber, op);
}

bool _compareNumbers(num actual, num expected, String op) {
  switch (op) {
    case 'gt':
      return actual > expected;
    case 'gte':
      return actual >= expected;
    case 'lt':
      return actual < expected;
    case 'lte':
      return actual <= expected;
    default:
      return false;
  }
}

bool _compareIn(dynamic actual, String expected) {
  final actualString = _stringifyActual(actual);
  return expected
      .split(',')
      .map((value) => value.trim())
      .where((value) => value.isNotEmpty)
      .any(
          (candidate) => candidate.toLowerCase() == actualString.toLowerCase());
}

bool _compareContains(dynamic actual, String expected, String valueType) {
  if (valueType == 'string[]' && actual is Iterable) {
    return actual.any(
      (value) =>
          _stringifyActual(value).toLowerCase() == expected.toLowerCase(),
    );
  }
  return _stringifyActual(actual)
      .toLowerCase()
      .contains(expected.toLowerCase());
}

num? _parseDateTime(dynamic value) {
  if (value is DateTime) {
    return value.millisecondsSinceEpoch;
  }
  if (value is num) {
    return value;
  }
  final text = _stringifyActual(value);
  if (text.isEmpty) {
    return null;
  }
  final asNum = num.tryParse(text);
  if (asNum != null &&
      !text.contains('T') &&
      !RegExp(r'^\d{4}-\d{2}-\d{2}').hasMatch(text)) {
    return asNum;
  }
  try {
    return DateTime.parse(text).millisecondsSinceEpoch;
  } catch (_) {
    return null;
  }
}

num? _parseNumber(dynamic value) {
  if (value is num && value.isFinite) {
    return value;
  }
  final text = _stringifyActual(value);
  if (text.isEmpty) {
    return null;
  }
  return num.tryParse(text);
}
