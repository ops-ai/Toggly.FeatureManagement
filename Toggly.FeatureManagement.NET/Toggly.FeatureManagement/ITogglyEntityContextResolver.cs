using Toggly.FeatureManagement.Context;

namespace Toggly.FeatureManagement
{
    /// <summary>
    /// Maps a domain object registered via <see cref="Configuration.EntityContextServiceCollectionExtensions.AddTogglyEntityContext{T}"/>
    /// to a canonical <see cref="TogglyEntityContext"/>.
    /// </summary>
    public interface ITogglyEntityContextResolver
    {
        bool TryResolve<T>(T instance, out TogglyEntityContext? context);
    }
}
