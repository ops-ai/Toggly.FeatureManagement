import 'package:flutter_test/flutter_test.dart';
import 'package:feature_flags_toggly/src/entity_gate.dart';

void main() {
  final datetimeGate = EntityGate(
    requirement: 'all',
    rules: [
      EntityGateRule(
        property: 'BirthDate',
        op: 'gt',
        value: '2026-01-01',
        type: 'datetime',
      ),
    ],
  );

  tearDown(clearRegisteredContexts);

  test('detects entity gates and fails closed', () {
    expect(isEntityGate(true), isFalse);
    expect(isEntityGate(datetimeGate), isTrue);
    expect(resolveEvaluatedDefinition(datetimeGate), isFalse);
    expect(resolveEvaluatedDefinition(null, defaultValue: true), isTrue);
    expect(resolveEvaluatedDefinition(false, defaultValue: true), isFalse);
    expect(resolveEvaluatedDefinition(datetimeGate, defaultValue: true), isFalse);
  });

  test('evaluates datetime gt and flattens snapshots', () {
    expect(
      resolveEvaluatedDefinition(
        datetimeGate,
        context: TogglyEntityContext(
          kind: 'Puppy',
          key: '1',
          attributes: {'BirthDate': '2026-06-15T00:00:00Z'},
        ),
      ),
      isTrue,
    );
    expect(
      toBooleanDefinitions({'On': true, 'Off': false, 'Gated': datetimeGate}),
      {'On': true, 'Off': false, 'Gated': false},
    );
  });

  test('operators and fail-closed branches', () {
    final anyGate = EntityGate(
      requirement: 'any',
      rules: [
        EntityGateRule(property: 'Color', op: 'eq', value: 'red'),
        EntityGateRule(property: 'Color', op: 'eq', value: 'blue'),
      ],
    );
    expect(applyEntityGate(anyGate, {'Color': 'blue'}), isTrue);
    expect(
      applyEntityGate(EntityGate(requirement: 'all', rules: anyGate.rules), {'Color': 'blue'}),
      isFalse,
    );
    expect(
      applyEntityGate(
        EntityGate(requirement: 'all', rules: [
          EntityGateRule(property: 'Color', op: 'neq', value: 'red'),
        ]),
        {},
      ),
      isFalse,
    );
    expect(
      applyEntityGate(
        EntityGate(requirement: 'all', rules: [
          EntityGateRule(property: 'Code', op: 'gt', value: '9'),
        ]),
        {'Code': '10'},
      ),
      isFalse,
    );
    expect(
      applyEntityGate(
        EntityGate(requirement: 'all', rules: [
          EntityGateRule(property: 'color', op: 'eq', value: 'RED'),
        ]),
        {'Color': 'red'},
      ),
      isTrue,
    );
    expect(applyEntityGate(EntityGate(requirement: 'all', rules: []), {'Color': 'red'}), isFalse);
    expect(
      applyEntityGate(
        EntityGate(requirement: 'all', rules: [
          EntityGateRule(property: 'Age', op: 'gte', value: '2', type: 'number'),
        ]),
        {'Age': 2},
      ),
      isTrue,
    );
    expect(
      applyEntityGate(
        EntityGate(requirement: 'all', rules: [
          EntityGateRule(property: 'Color', op: 'in', value: 'red, blue'),
        ]),
        {'Color': 'BLUE'},
      ),
      isTrue,
    );
    expect(
      applyEntityGate(
        EntityGate(requirement: 'all', rules: [
          EntityGateRule(property: 'Name', op: 'contains', value: 'pup'),
        ]),
        {'Name': 'Puppy'},
      ),
      isTrue,
    );
    expect(
      applyEntityGate(
        EntityGate(requirement: 'all', rules: [
          EntityGateRule(property: 'Tags', op: 'contains', value: 'beta', type: 'string[]'),
        ]),
        {'Tags': ['GA', 'Beta']},
      ),
      isTrue,
    );
    expect(
      applyEntityGate(
        EntityGate(requirement: 'all', rules: [
          EntityGateRule(property: 'Color', op: 'matches', value: 'red'),
        ]),
        {'Color': 'red'},
      ),
      isFalse,
    );
  });

  test('parses mixed JSON definitions', () {
    final parsed = parseEvaluatedDefinitions({
      'On': true,
      'Gated': {
        'requirement': 'all',
        'rules': [
          {'property': 'Color', 'op': 'eq', 'value': 'red'},
        ],
      },
    });
    expect(toBooleanDefinitions(parsed)['Gated'], isFalse);
    expect(
      resolveEvaluatedDefinition(
        parsed['Gated'],
        context: TogglyEntityContext(kind: 'Puppy', key: '1', attributes: {'Color': 'red'}),
      ),
      isTrue,
    );
  });

  test('registerContext is local only', () {
    registerContext('Puppy', (entity) {
      final puppy = entity as Map;
      return TogglyEntityContext(
        kind: 'Puppy',
        key: puppy['id'] as String,
        attributes: {'Color': puppy['color']},
      );
    });
    expect(mapEntityContext('Puppy', {'id': '1', 'color': 'red'})?.key, '1');
    expect(resolveEntityContext('Kitten', {'id': '1'}), isNull);
  });
}
