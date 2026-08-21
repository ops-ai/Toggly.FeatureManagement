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
    fallback?: React.ReactNode;
    /** Render prop for conditional styling; always invoked with resolved gate boolean. */
    render?: (enabled: boolean) => React.ReactNode;
};
declare class Feature extends React.Component<FeatureProps, {
    shouldShow: boolean;
}> {
    static contextType: React.Context<import("../../contexts/toggly.context").TogglyContext>;
    context: React.ContextType<typeof context>;
    private unsubscribeRefresh;
    private unsubscribeLocalGates;
    constructor(props: FeatureProps);
    private buildGate;
    private applyVariantFilter;
    private runGate;
    componentDidMount(): void;
    componentDidUpdate(prevProps: FeatureProps): void;
    componentWillUnmount(): void;
    render(): string | number | boolean | React.ReactFragment | JSX.Element | null | undefined;
}
export default Feature;
