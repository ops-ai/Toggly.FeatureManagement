using Azure.Core;
using Azure.Identity;
using Azure.Security.KeyVault.Certificates;
using Azure.Security.KeyVault.Secrets;
using Raven.Client.Documents;
using System.Security.Cryptography.X509Certificates;

namespace Demo.Mvc.Multitenant
{
    public static class ServiceRegistrationExtensions
    {
        public static void AddRavenDb(this IServiceCollection services, IConfiguration ravenConfiguration)
        {
            TokenCredential? clientCredential = Environment.GetEnvironmentVariable("ClientId") != null ? new ClientSecretCredential(Environment.GetEnvironmentVariable("TenantId"), Environment.GetEnvironmentVariable("ClientId"), Environment.GetEnvironmentVariable("ClientSecret")) : null;

            var client = new CertificateClient(vaultUri: new Uri(Environment.GetEnvironmentVariable("VaultUri")!), credential: clientCredential ?? new DefaultAzureCredential());
            var secretClient = new SecretClient(new Uri(Environment.GetEnvironmentVariable("VaultUri")!), clientCredential ?? new DefaultAzureCredential());

            var certResponse = client.GetCertificate("RavenDB");
            var secretId = certResponse.Value.SecretId;
            var segments = secretId.Segments;
            var secretName = segments[2].Trim('/');
            var version = segments[3].TrimEnd('/');

            var secretResponse = secretClient.GetSecret(secretName, version);

            var secret = secretResponse.Value;
            var privateKeyBytes = Convert.FromBase64String(secret.Value);

            var ravenCert = new X509Certificate2(privateKeyBytes);

            IDocumentStore store = new DocumentStore
            {
                Urls = ravenConfiguration.GetSection("Urls").Get<string[]>(),
                Database = ravenConfiguration["DatabaseName"],
                Certificate = ravenCert
            };
            store.Initialize();
            services.AddSingleton(store);
        }
    }
}
