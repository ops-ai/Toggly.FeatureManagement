import type { EntityEvalContext, FeatureDefinitionModel, FeatureFilter } from './types';
export declare function isContextPropertyFilter(f: FeatureFilter): boolean;
export declare function splitFilters(def: FeatureDefinitionModel): {
    entity: FeatureFilter[];
    user: FeatureFilter[];
};
export declare function evaluateContextProperty(params: Record<string, unknown> | undefined, entity: EntityEvalContext): boolean;
export declare function evaluateEntityFilters(def: FeatureDefinitionModel, entity: EntityEvalContext): boolean;
