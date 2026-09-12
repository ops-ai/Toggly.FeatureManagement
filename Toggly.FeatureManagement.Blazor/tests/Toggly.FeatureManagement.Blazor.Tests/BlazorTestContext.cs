using Bunit;
using Xunit;
namespace Blazor.Tests;
public abstract class BlazorTestContext : BunitContext, IAsyncLifetime
{
    public Task InitializeAsync() => Task.CompletedTask;
    Task IAsyncLifetime.DisposeAsync() => DisposeAsync().AsTask();
}
