using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Toggly.FeatureManagement.Context;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class EntityContextRegistrationHostedServiceTests
{
    [Fact]
    public async Task Register_SkipsWhenDisabledOrMissingAppKeyOrEmptyRegistry()
    {
        var handler = new RecordingHandler(HttpStatusCode.OK);
        await InvokeRegister(CreateService(handler, new TogglySettings
        {
            RegisterContextsOnStartup = false,
            AppKey = "app"
        }, registerKind: true));
        handler.Requests.Should().BeEmpty();

        await InvokeRegister(CreateService(handler, new TogglySettings
        {
            RegisterContextsOnStartup = true,
            AppKey = ""
        }, registerKind: true));
        handler.Requests.Should().BeEmpty();

        await InvokeRegister(CreateService(handler, new TogglySettings
        {
            RegisterContextsOnStartup = true,
            AppKey = "app"
        }, registerKind: false));
        handler.Requests.Should().BeEmpty();
    }

    [Fact]
    public async Task Register_PutsCatalogOnSuccessAndLogsHttpFailures()
    {
        var ok = new RecordingHandler(HttpStatusCode.OK);
        await InvokeRegister(CreateService(ok, new TogglySettings
        {
            RegisterContextsOnStartup = true,
            AppKey = "app-key"
        }, registerKind: true));
        ok.Requests.Should().ContainSingle(r =>
            r.Method == HttpMethod.Put &&
            r.RequestUri!.ToString().Contains("sdk/app-key/contexts", StringComparison.Ordinal));

        var failed = new RecordingHandler(HttpStatusCode.InternalServerError);
        await InvokeRegister(CreateService(failed, new TogglySettings
        {
            RegisterContextsOnStartup = true,
            AppKey = "app-key"
        }, registerKind: true));
        failed.Requests.Should().ContainSingle();
    }

    [Fact]
    public async Task Register_SwallowsTransportErrors()
    {
        var handler = new RecordingHandler(throwOnSend: true);
        var act = () => InvokeRegister(CreateService(handler, new TogglySettings
        {
            RegisterContextsOnStartup = true,
            AppKey = "app-key"
        }, registerKind: true));
        await act.Should().NotThrowAsync();
    }

    [Fact]
    public async Task StartAndStop_Complete()
    {
        var service = CreateService(new RecordingHandler(HttpStatusCode.OK), new TogglySettings
        {
            RegisterContextsOnStartup = false
        }, registerKind: false);
        await service.StartAsync(CancellationToken.None);
        await service.StopAsync(CancellationToken.None);
    }

    private static EntityContextRegistrationHostedService CreateService(
        HttpMessageHandler handler,
        TogglySettings settings,
        bool registerKind)
    {
        var registry = new EntityContextRegistry();
        if (registerKind)
        {
            registry.Register(new EntityContextRegistration(
                typeof(Order),
                "Order",
                "Id",
                _ => "1",
                null,
                new[] { new EntityContextPropertyRegistration("Id", "number") }));
        }

        var factory = new Mock<IHttpClientFactory>();
        factory.Setup(f => f.CreateClient("toggly-app"))
            .Returns(new HttpClient(handler) { BaseAddress = new Uri("https://app.toggly.io/") });

        return new EntityContextRegistrationHostedService(
            factory.Object,
            Options.Create(settings),
            registry,
            NullLogger<EntityContextRegistrationHostedService>.Instance);
    }

    private static Task InvokeRegister(EntityContextRegistrationHostedService service)
    {
        var method = typeof(EntityContextRegistrationHostedService).GetMethod(
            "RegisterSafelyAsync",
            BindingFlags.Instance | BindingFlags.NonPublic);
        method.Should().NotBeNull();
        return (Task)method!.Invoke(service, new object[] { CancellationToken.None })!;
    }

    private sealed class Order
    {
        public int Id { get; set; }
    }

    private sealed class RecordingHandler : HttpMessageHandler
    {
        private readonly HttpStatusCode _status;
        private readonly bool _throwOnSend;

        public RecordingHandler(HttpStatusCode status = HttpStatusCode.OK, bool throwOnSend = false)
        {
            _status = status;
            _throwOnSend = throwOnSend;
        }

        public List<HttpRequestMessage> Requests { get; } = new();

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add(request);
            if (_throwOnSend)
                throw new HttpRequestException("network down");

            return Task.FromResult(new HttpResponseMessage(_status)
            {
                Content = new StringContent("{}")
            });
        }
    }
}
