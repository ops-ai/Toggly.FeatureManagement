import { FeatureRequirement } from '../lib/models';
import { Toggly } from '../lib/toggly';

beforeAll(() => {
  return Toggly.init({
    flagDefaults: {
      "ExampleFeatureKey1": true,
      "ExampleFeatureKey2": false
    }
  });
});

test('Check (isFeatureOn) result based on provided *.flagDefaults', () => {
  expect(Toggly.isFeatureOn('ExampleFeatureKey1')).toBe(true);
  expect(Toggly.isFeatureOn('ExampleFeatureKey2')).toBe(false);
});

test('Check (isFeatureOff) result based on provided *.flagDefaults', () => {
  expect(Toggly.isFeatureOff('ExampleFeatureKey1')).toBe(false);
  expect(Toggly.isFeatureOff('ExampleFeatureKey2')).toBe(true);
});

test('Check (evaluateFeatureGate, requirement: All) result based on provided *.flagDefaults', () => {
  return expect(Toggly.evaluateFeatureGate(['ExampleFeatureKey1', 'ExampleFeatureKey2'], FeatureRequirement.all)).toBe(false);
});

test('Check (evaluateFeatureGate, requirement: Any) result based on provided *.flagDefaults', () => {
  return expect(Toggly.evaluateFeatureGate(['ExampleFeatureKey1', 'ExampleFeatureKey2'], FeatureRequirement.any)).toBe(true);
});

test('Check (evaluateFeatureGate, negate) result based on provided *.flagDefaults', () => {
  return expect(Toggly.evaluateFeatureGate(['ExampleFeatureKey1'], FeatureRequirement.all, true)).toBe(false);
});
