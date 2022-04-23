using System.Threading.Tasks;

namespace Toggly.FeatureManagement
{
    public interface IFeatureContextProvider
    {
        /// <summary>
        /// Store a value tracking the current already recorded usage of this feature
        /// </summary>
        /// <param name="featureName">Name of the feature being checked</param>
        /// <returns>true if the feaure was already counted in the current request or false
        /// if it's the first time the feature is checked in the current request</returns>
        Task<bool> AccessedInRequestAsync(string featureName);

        /// <summary>
        /// Store a value tracking the current already recorded usage of this feature
        /// </summary>
        /// <typeparam name="TContext"></typeparam>
        /// <param name="featureName"></param>
        /// <param name="context"></param>
        /// <returns>true if the feaure was already counted in the current request or false
        /// if it's the first time the feature is checked in the current request</returns>
        Task<bool> AccessedInRequestAsync<TContext>(string featureName, TContext context);

        /// <summary>
        /// Get the unique identifier being tracked. Ex: Username, IP Address
        /// </summary>
        /// <returns></returns>
        Task<string> GetContextIdentifierAsync();

        /// <summary>
        /// Get the unique identifier being tracked. Ex: Username, IP Address
        /// </summary>
        /// <typeparam name="TContext">Context passed in</typeparam>
        /// <param name="context"></param>
        /// <returns></returns>
        Task<string> GetContextIdentifierAsync<TContext>(TContext context);
    }
}
