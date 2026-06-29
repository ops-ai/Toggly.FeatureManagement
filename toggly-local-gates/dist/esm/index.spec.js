import { applyLocalGate, applyLocalGatesToMap, buildFlagGateIndex, isLocalPrerequisiteMet, } from './index';
describe('toggly-local-gates', () => {
    const apiRedesignGate = {
        id: 'apiRedesign',
        flagKeys: ['ApiV2Checkout', 'ApiV2Profile'],
        isEnabled: () => true,
    };
    describe('buildFlagGateIndex', () => {
        it('maps flag keys to gate ids', () => {
            const index = buildFlagGateIndex([apiRedesignGate]);
            expect(index.get('ApiV2Checkout')).toBe('apiRedesign');
            expect(index.get('ApiV2Profile')).toBe('apiRedesign');
            expect(index.get('Other')).toBeUndefined();
        });
        it('throws when a flag key is registered on multiple gates', () => {
            const other = {
                id: 'other',
                flagKeys: ['ApiV2Checkout'],
                isEnabled: () => true,
            };
            expect(() => buildFlagGateIndex([apiRedesignGate, other])).toThrow(/multiple local gates/);
        });
    });
    describe('applyLocalGate', () => {
        const index = buildFlagGateIndex([apiRedesignGate]);
        it('returns false when remote is false regardless of gate', () => {
            const gateOff = { ...apiRedesignGate, isEnabled: () => false };
            expect(applyLocalGate(false, 'ApiV2Checkout', [gateOff], index)).toBe(false);
        });
        it('ANDs remote true with local gate when gated', () => {
            const gateOn = { ...apiRedesignGate, isEnabled: () => true };
            const gateOff = { ...apiRedesignGate, isEnabled: () => false };
            expect(applyLocalGate(true, 'ApiV2Checkout', [gateOn], index)).toBe(true);
            expect(applyLocalGate(true, 'ApiV2Checkout', [gateOff], index)).toBe(false);
        });
        it('passes remote through for ungated keys', () => {
            expect(applyLocalGate(true, 'Ungated', [apiRedesignGate], index)).toBe(true);
            expect(applyLocalGate(false, 'Ungated', [apiRedesignGate], index)).toBe(false);
        });
    });
    describe('isLocalPrerequisiteMet', () => {
        const index = buildFlagGateIndex([apiRedesignGate]);
        it('returns true for ungated keys', () => {
            expect(isLocalPrerequisiteMet('Other', [apiRedesignGate], index)).toBe(true);
        });
    });
    describe('applyLocalGatesToMap', () => {
        it('applies gates to all keys in the map', () => {
            const gateOff = { ...apiRedesignGate, isEnabled: () => false };
            const index = buildFlagGateIndex([gateOff]);
            expect(applyLocalGatesToMap({ ApiV2Checkout: true, Other: true }, [gateOff], index)).toEqual({ ApiV2Checkout: false, Other: true });
        });
    });
});
