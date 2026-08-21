using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading;
using System.Threading.Tasks;
using Toggly.FeatureManagement.Context;

namespace Toggly.FeatureManagement
{
    internal sealed class EntityContextRegistrationHostedService : IHostedService
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IOptions<TogglySettings> _settings;
        private readonly EntityContextRegistry _registry;
        private readonly ILogger<EntityContextRegistrationHostedService> _logger;

        public EntityContextRegistrationHostedService(
            IHttpClientFactory httpClientFactory,
            IOptions<TogglySettings> settings,
            EntityContextRegistry registry,
            ILogger<EntityContextRegistrationHostedService> logger)
        {
            _httpClientFactory = httpClientFactory;
            _settings = settings;
            _registry = registry;
            _logger = logger;
        }

        public Task StartAsync(CancellationToken cancellationToken)
        {
            _ = RegisterSafelyAsync(CancellationToken.None);
            return Task.CompletedTask;
        }

        private async Task RegisterSafelyAsync(CancellationToken cancellationToken)
        {
            try
            {
                await RegisterAsync(cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(
                    ex,
                    "Toggly entity context registration failed. Dashboard catalog was not updated.");
            }
        }

        private async Task RegisterAsync(CancellationToken cancellationToken)
        {
            var settings = _settings.Value;
            if (!settings.RegisterContextsOnStartup)
                return;

            if (string.IsNullOrWhiteSpace(settings.AppKey))
            {
                _logger.LogDebug("Skipping Toggly context registration because AppKey is not configured.");
                return;
            }

            var registrations = _registry.GetAll();
            if (registrations.Count == 0)
                return;

            var payload = new SdkContextRegistrationRequest
            {
                Contexts = registrations.Select(MapRegistration).ToList()
            };

            var client = _httpClientFactory.CreateClient("toggly-app");
            var response = await client.PutAsJsonAsync(
                $"sdk/{settings.AppKey}/contexts",
                payload,
                cancellationToken).ConfigureAwait(false);

            if (response.IsSuccessStatusCode)
            {
                _logger.LogInformation(
                    "Registered {Count} Toggly entity context kind(s) at startup.",
                    payload.Contexts.Count);
                return;
            }

            _logger.LogWarning(
                "Toggly entity context registration returned HTTP {StatusCode}. Dashboard catalog was not updated.",
                (int)response.StatusCode);
        }

        public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

        private static SdkContextRegistrationItem MapRegistration(EntityContextRegistration registration)
        {
            return new SdkContextRegistrationItem
            {
                Kind = registration.Kind,
                KeyProperty = registration.KeyPropertyName,
                DisplayName = registration.Kind,
                Properties = registration.SchemaProperties
                    .Select(p => new SdkContextProperty { Name = p.Name, Type = p.Type })
                    .ToList()
            };
        }

        private sealed class SdkContextRegistrationRequest
        {
            public List<SdkContextRegistrationItem> Contexts { get; set; } = new List<SdkContextRegistrationItem>();
        }

        private sealed class SdkContextRegistrationItem
        {
            public string? Kind { get; set; }
            public string? KeyProperty { get; set; }
            public string? DisplayName { get; set; }
            public List<SdkContextProperty>? Properties { get; set; }
        }

        private sealed class SdkContextProperty
        {
            public string? Name { get; set; }
            public string? Type { get; set; }
        }
    }
}
