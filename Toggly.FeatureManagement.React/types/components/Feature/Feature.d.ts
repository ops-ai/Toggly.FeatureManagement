import React from 'react';
import type { TogglyEntityContext } from '@ops-ai/toggly-hooks-types';
import { context } from '../../contexts';
type FeatureProps = {
    featureKey?: string;
    featureKeys?: string[];
    /** When set (with {@link featureKey}), children render only if the assigned variant name matches. */
    variant?: string;
    requirement?: string;
    negate?: boolean;
    /** Entity instance or canonical {@link TogglyEntityContext} for entity-gated flags. */
    context?: TogglyEntityContext | Record<string, unknown> | null;
    /** Context kind for {@link registerContext} mapper lookup when `context` is a domain object. */
    contextKind?: string;
    children?: React.ReactNode;
    /**
     * @deprecated Off-path content: use a separate `<Feature negate>` instead.
     * Still accepted for one release; prefer `negate`.
     */
    fallback?: React.ReactNode;
    /** Render prop for conditional styling; always invoked with resolved gate boolean. */
    render?: (enabled: boolean) => React.ReactNode;
};
declare class Feature extends React.Component<FeatureProps, {
    shouldShow: boolean;
}> {
    static readonly contextType: React.Context<import("../../contexts/toggly.context").TogglyContext>;
    readonly context: React.ContextType<typeof context>;
    private subscribedService?;
    private mounted;
    private evaluation;
    private unsubscribeRefresh;
    private unsubscribeLocalGates;
    constructor(props: FeatureProps);
    private buildGate;
    private applyVariantFilter;
    private runGate;
    private bindService;
    componentDidMount(): void;
    componentDidUpdate(prevProps: FeatureProps): void;
    componentWillUnmount(): void;
    render(): string | number | boolean | Iterable<React.ReactNode> | React.JSX.Element | null | undefined;
}
export default Feature;
