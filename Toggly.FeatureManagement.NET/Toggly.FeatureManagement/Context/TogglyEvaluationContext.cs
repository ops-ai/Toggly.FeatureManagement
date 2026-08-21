namespace Toggly.FeatureManagement.Context
{
    /// <summary>
    /// Combined user + optional entity context for a single feature evaluation.
    /// </summary>
    public sealed class TogglyEvaluationContext
    {
        public TogglyEvaluationContext(TogglyEntityContext? entity = null)
        {
            Entity = entity;
        }

        public TogglyEntityContext? Entity { get; }
    }
}
