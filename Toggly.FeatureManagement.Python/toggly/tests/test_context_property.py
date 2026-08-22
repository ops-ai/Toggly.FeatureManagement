from datetime import datetime, timezone

from toggly.context import EvaluationContext, TogglyEntityContext
from toggly.evaluator import ContextPropertyEvaluator, EvaluationEngine
from toggly.models import FeatureDefinition, FeatureFilter


def _filter(prop, op, value, value_type="string"):
    return FeatureFilter(
        name="ContextProperty",
        parameters={"Property": prop, "Operator": op, "Value": value, "ValueType": value_type},
    )


def test_eq_in_contains_and_requirement():
    definition = FeatureDefinition(
        feature_key="orders",
        requirement_type="Any",
        context_requirement_type="All",
        filters=[
            _filter("Color", "eq", "red"),
            _filter("Age", "gte", "2", "number"),
            FeatureFilter(name="AlwaysOn", parameters={}),
        ],
    )
    entity = TogglyEntityContext("Order", "1", {"color": "red", "Age": 3})
    assert ContextPropertyEvaluator.evaluate_entity_filters(definition, entity) is True
    engine = EvaluationEngine()
    assert engine.evaluate(definition, EvaluationContext(entity=entity)) is True
    assert engine.evaluate(definition, EvaluationContext()) is False


def test_missing_attr_unknown_op_fail_closed():
    definition = FeatureDefinition(
        feature_key="f",
        requirement_type="All",
        filters=[_filter("Color", "neq", "red")],
    )
    assert ContextPropertyEvaluator.evaluate_entity_filters(
        definition, TogglyEntityContext("Order", "1", {})
    ) is False
    unknown = FeatureDefinition(
        feature_key="f",
        filters=[_filter("Color", "matches", "red")],
    )
    assert ContextPropertyEvaluator.evaluate_entity_filters(
        unknown, TogglyEntityContext("Order", "1", {"Color": "red"})
    ) is False


def test_in_contains_datetime():
    assert ContextPropertyEvaluator.evaluate_entity_filters(
        FeatureDefinition(feature_key="f", requirement_type="All", filters=[_filter("Color", "in", "red, blue")]),
        TogglyEntityContext("P", "1", {"Color": "BLUE"}),
    )
    assert ContextPropertyEvaluator.evaluate_entity_filters(
        FeatureDefinition(feature_key="f", requirement_type="All", filters=[_filter("Name", "contains", "pup")]),
        TogglyEntityContext("P", "1", {"Name": "Order"}),
    )
    born = datetime(2026, 7, 1, tzinfo=timezone.utc)
    assert ContextPropertyEvaluator.evaluate_entity_filters(
        FeatureDefinition(
            feature_key="f",
            requirement_type="All",
            filters=[_filter("Born", "gt", "2026-06-10T00:00:00Z", "datetime")],
        ),
        TogglyEntityContext("O", "1", {"Born": born}),
    )


def test_any_context_requirement():
    definition = FeatureDefinition(
        feature_key="f",
        requirement_type="All",
        context_requirement_type="Any",
        filters=[
            _filter("Color", "eq", "red"),
            _filter("Color", "eq", "blue"),
        ],
    )
    entity = TogglyEntityContext("Order", "1", {"Color": "red"})
    assert ContextPropertyEvaluator.evaluate_entity_filters(definition, entity) is True
