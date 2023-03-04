import React from 'react';
import { context } from '../../contexts';
type FeatureProps = {
    featureKey?: string;
    featureKeys?: string[];
    requirement?: string;
    negate?: boolean;
    children: React.ReactNode;
};
declare class Feature extends React.Component<FeatureProps, {
    gate: string[];
    shouldShow: boolean;
}> {
    static contextType: React.Context<import("../../contexts/toggly.context").TogglyContext>;
    context: React.ContextType<typeof context>;
    constructor(props: FeatureProps);
    componentDidMount(): void;
    render(): React.ReactNode;
}
export default Feature;
