using Toggly.CLI.Services;
using Xunit;

namespace Toggly.CLI.Tests;

public class SecureTokenStoreFactoryTests
{
    [Fact]
    public void Create_ReturnsPlatformStoreOnSupportedOs()
    {
        var store = SecureTokenStore.Create();
        Assert.NotNull(store);
        Assert.IsAssignableFrom<ISecureTokenStore>(store);
    }

    [Fact]
    public void Create_ReturnsDistinctInstances()
    {
        var first = SecureTokenStore.Create();
        var second = SecureTokenStore.Create();
        Assert.NotSame(first, second);
    }
}
