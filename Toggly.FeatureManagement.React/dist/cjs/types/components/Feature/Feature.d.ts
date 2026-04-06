import React from 'react';
import { context } from '../../contexts';
type FeatureProps = {
    featureKey?: string;
    featureKeys?: string[];
    /** When set (with {@link featureKey}), children render only if the assigned variant name matches. */
    variant?: string;
    requirement?: string;
    negate?: boolean;
    children: React.ReactNode;
};
declare class Feature extends React.Component<FeatureProps, {
    shouldShow: boolean;
}> {
    static contextType: React.Context<import("../../contexts/toggly.context").TogglyContext>;
    context: React.ContextType<typeof context>;
    private unsubscribeRefresh;
    constructor(props: FeatureProps);
    private buildGate;
    private applyVariantFilter;
    private runGate;
    componentDidMount(): void;
    componentDidUpdate(prevProps: FeatureProps): void;
    componentWillUnmount(): void;
    render(): React.ReactNode;
}
export default Feature;
