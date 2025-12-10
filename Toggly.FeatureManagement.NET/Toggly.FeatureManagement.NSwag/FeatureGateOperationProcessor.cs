using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Http;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.Mvc;
using NSwag.Generation.AspNetCore;
using NSwag.Generation.Processors;
using NSwag.Generation.Processors.Contexts;
using System;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;

namespace Toggly.FeatureManagement.NSwag
{
    /// <summary>
    /// NSwag operation processor that excludes operations from Swagger documentation
    /// when their associated feature flags are disabled.
    /// </summary>
    public class FeatureGateOperationProcessor : IOperationProcessor
    {
        private readonly IServiceProvider? _rootServiceProvider;
        private readonly IHttpContextAccessor? _httpContextAccessor;
        /// <summary>
        /// Initializes a new instance of the <see cref="FeatureGateOperationProcessor"/> class.
        /// </summary>
        /// <param name="serviceProvider">Service provider to resolve IFeatureManager.</param>
        public FeatureGateOperationProcessor(IServiceProvider? serviceProvider = null)
        {
            _rootServiceProvider = serviceProvider;
            _httpContextAccessor = serviceProvider?.GetService(typeof(IHttpContextAccessor)) as IHttpContextAccessor;
        }

        /// <summary>
        /// Processes the operation and determines if it should be included in the Swagger document.
        /// </summary>
        /// <param name="context">The operation processor context.</param>
        /// <returns>True if the operation should be included, false to exclude it.</returns>
        public bool Process(OperationProcessorContext context)
        {
            // Cast to AspNetCoreOperationProcessorContext to access ASP.NET Core specific information
            if (context is not AspNetCoreOperationProcessorContext aspNetCoreContext)
                return true; // Include if we can't determine the context

            var actionDescriptor = aspNetCoreContext.ApiDescription?.ActionDescriptor;
            if (actionDescriptor == null)
                return true; // Include if we can't determine the action

            // Prefer request scope for scoped services; fall back to root only for singleton/transient
            var requestServices = _httpContextAccessor?.HttpContext?.RequestServices;
            var featureManagerSnapshot = requestServices?.GetService(typeof(IFeatureManagerSnapshot)) as IFeatureManagerSnapshot;
            var featureManager = featureManagerSnapshot
                ?? (requestServices?.GetService(typeof(IFeatureManager)) as IFeatureManager)
                ?? (_rootServiceProvider?.GetService(typeof(IFeatureManager)) as IFeatureManager);

            // Check controller-level FeatureGate attribute
            if (actionDescriptor is ControllerActionDescriptor controllerActionDescriptor)
            {
                var controllerType = controllerActionDescriptor.ControllerTypeInfo;
                if (controllerType != null)
                {
                    var controllerFeatureGate = controllerType.GetCustomAttribute<FeatureGateAttribute>();
                    if (controllerFeatureGate != null)
                    {
                        if (!IsFeatureEnabled(controllerFeatureGate, featureManagerSnapshot, featureManager))
                            return false; // Exclude from Swagger
                    }
                }

                // Check action-level FeatureGate attribute
                var methodInfo = controllerActionDescriptor.MethodInfo;
                if (methodInfo != null)
                {
                    var actionFeatureGate = methodInfo.GetCustomAttribute<FeatureGateAttribute>();
                    if (actionFeatureGate != null)
                    {
                        if (!IsFeatureEnabled(actionFeatureGate, featureManagerSnapshot, featureManager))
                            return false; // Exclude from Swagger
                    }
                }
            }

            return true; // Include in Swagger
        }

        /// <summary>
        /// Checks if the feature flags specified in the FeatureGate attribute are enabled.
        /// </summary>
        /// <param name="featureGate">The FeatureGate attribute to evaluate.</param>
        /// <returns>True if the feature gate requirements are met, false otherwise.</returns>
        private bool IsFeatureEnabled(FeatureGateAttribute featureGate, IFeatureManagerSnapshot? featureManagerSnapshot, IFeatureManager? featureManager)
        {
            if (featureManagerSnapshot == null && featureManager == null)
                return true; // No provider available, include by default

            if (featureManager == null)
                return true; // If no feature manager, include the operation

            var features = featureGate.Features;
            var requirementType = featureGate.RequirementType;

            if (requirementType == RequirementType.All)
            {
                // All features must be enabled
                return features.All(feature => 
                    Task.Run(async () => await featureManager.IsEnabledAsync(feature)).Result);
            }
            else
            {
                // Any feature must be enabled
                return features.Any(feature => 
                    Task.Run(async () => await featureManager.IsEnabledAsync(feature)).Result);
            }
        }
    }
}
