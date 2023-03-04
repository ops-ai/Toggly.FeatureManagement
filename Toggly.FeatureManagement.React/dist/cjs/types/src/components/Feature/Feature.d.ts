export interface FeatureProps {
    label: string;
    featureKey: string | undefined;
    featureKeys: string[] | undefined;
    requirement: string;
    negate: boolean;
}
declare const Feature: (props: FeatureProps) => JSX.Element;
export default Feature;
