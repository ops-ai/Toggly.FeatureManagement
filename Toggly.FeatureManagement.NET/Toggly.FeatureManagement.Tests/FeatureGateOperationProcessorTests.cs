using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.ApiExplorer;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.Mvc;
using Moq;
using NJsonSchema.Generation;
using NSwag;
using NSwag.Generation;
using NSwag.Generation.AspNetCore;
using NSwag.Generation.Processors;
using NSwag.Generation.Processors.Contexts;
using Toggly.FeatureManagement.NSwag;
using Xunit;

namespace Toggly.FeatureManagement.Tests
{
    public class FeatureGateOperationProcessorTests
    {
        private readonly Mock<IServiceProvider> _serviceProviderMock;
        private readonly Mock<IHttpContextAccessor> _httpContextAccessorMock;
        private readonly Mock<IFeatureManager> _featureManagerMock;
        private readonly Mock<IFeatureManagerSnapshot> _featureManagerSnapshotMock;
        private FeatureGateOperationProcessor _processor = null!;

        public FeatureGateOperationProcessorTests()
        {
            _serviceProviderMock = new Mock<IServiceProvider>();
            _httpContextAccessorMock = new Mock<IHttpContextAccessor>();
            _featureManagerMock = new Mock<IFeatureManager>();
            _featureManagerSnapshotMock = new Mock<IFeatureManagerSnapshot>();
        }

        #region Constructor Tests

        [Fact]
        public void Constructor_WithNullServiceProvider_DoesNotThrow()
        {
            // Act
            var processor = new FeatureGateOperationProcessor(null);

            // Assert
            processor.Should().NotBeNull();
        }

        [Fact]
        public void Constructor_WithServiceProvider_InitializesCorrectly()
        {
            // Arrange
            _serviceProviderMock.Setup(x => x.GetService(typeof(IHttpContextAccessor)))
                .Returns(_httpContextAccessorMock.Object);

            // Act
            var processor = new FeatureGateOperationProcessor(_serviceProviderMock.Object);

            // Assert
            processor.Should().NotBeNull();
        }

        #endregion

        #region Process Tests - Context Type Handling

        [Fact]
        public void Process_WithNonAspNetCoreContext_ReturnsTrue()
        {
            // Arrange
            _processor = new FeatureGateOperationProcessor(null);
            var contextMock = new Mock<OperationProcessorContext>(
                new OpenApiDocument(),
                new OpenApiOperationDescription(),
                typeof(object),
                typeof(object).GetMethod("ToString")!,
                null!, // SwaggerGenerator
                null!, // AllOperationDescriptions
                null!, // Settings
                null!  // SchemaResolver
            );

            // Act
            var result = _processor.Process(contextMock.Object);

            // Assert
            result.Should().BeTrue();
        }

        #endregion

        #region Process Tests - Feature Gate on Controller

        [Fact]
        public void Process_WithControllerFeatureGate_FeatureDisabled_ReturnsFalse()
        {
            // Arrange
            SetupProcessorWithFeatureManager();
            _featureManagerMock.Setup(x => x.IsEnabledAsync("TestFeature"))
                .ReturnsAsync(false);

            var context = CreateAspNetCoreContext<ControllerWithFeatureGate>(nameof(ControllerWithFeatureGate.GetAction));

            // Act
            var result = _processor.Process(context);

            // Assert
            result.Should().BeFalse();
        }

        [Fact]
        public void Process_WithControllerFeatureGate_FeatureEnabled_ReturnsTrue()
        {
            // Arrange
            SetupProcessorWithFeatureManager();
            _featureManagerMock.Setup(x => x.IsEnabledAsync("TestFeature"))
                .ReturnsAsync(true);

            var context = CreateAspNetCoreContext<ControllerWithFeatureGate>(nameof(ControllerWithFeatureGate.GetAction));

            // Act
            var result = _processor.Process(context);

            // Assert
            result.Should().BeTrue();
        }

        #endregion

        #region Process Tests - Feature Gate on Action

        [Fact]
        public void Process_WithActionFeatureGate_FeatureDisabled_ReturnsFalse()
        {
            // Arrange
            SetupProcessorWithFeatureManager();
            _featureManagerMock.Setup(x => x.IsEnabledAsync("ActionFeature"))
                .ReturnsAsync(false);

            var context = CreateAspNetCoreContext<ControllerWithoutFeatureGate>(nameof(ControllerWithoutFeatureGate.ActionWithFeatureGate));

            // Act
            var result = _processor.Process(context);

            // Assert
            result.Should().BeFalse();
        }

        [Fact]
        public void Process_WithActionFeatureGate_FeatureEnabled_ReturnsTrue()
        {
            // Arrange
            SetupProcessorWithFeatureManager();
            _featureManagerMock.Setup(x => x.IsEnabledAsync("ActionFeature"))
                .ReturnsAsync(true);

            var context = CreateAspNetCoreContext<ControllerWithoutFeatureGate>(nameof(ControllerWithoutFeatureGate.ActionWithFeatureGate));

            // Act
            var result = _processor.Process(context);

            // Assert
            result.Should().BeTrue();
        }

        #endregion

        #region Process Tests - No Feature Gate

        [Fact]
        public void Process_WithNoFeatureGate_ReturnsTrue()
        {
            // Arrange
            SetupProcessorWithFeatureManager();
            var context = CreateAspNetCoreContext<ControllerWithoutFeatureGate>(nameof(ControllerWithoutFeatureGate.ActionWithoutFeatureGate));

            // Act
            var result = _processor.Process(context);

            // Assert
            result.Should().BeTrue();
        }

        #endregion

        #region Process Tests - RequirementType.All

        [Fact]
        public void Process_WithRequirementTypeAll_AllFeaturesEnabled_ReturnsTrue()
        {
            // Arrange
            SetupProcessorWithFeatureManager();
            _featureManagerMock.Setup(x => x.IsEnabledAsync("Feature1"))
                .ReturnsAsync(true);
            _featureManagerMock.Setup(x => x.IsEnabledAsync("Feature2"))
                .ReturnsAsync(true);

            var context = CreateAspNetCoreContext<ControllerWithoutFeatureGate>(nameof(ControllerWithoutFeatureGate.ActionWithRequirementTypeAll));

            // Act
            var result = _processor.Process(context);

            // Assert
            result.Should().BeTrue();
        }

        [Fact]
        public void Process_WithRequirementTypeAll_SomeFeatureDisabled_ReturnsFalse()
        {
            // Arrange
            SetupProcessorWithFeatureManager();
            _featureManagerMock.Setup(x => x.IsEnabledAsync("Feature1"))
                .ReturnsAsync(true);
            _featureManagerMock.Setup(x => x.IsEnabledAsync("Feature2"))
                .ReturnsAsync(false);

            var context = CreateAspNetCoreContext<ControllerWithoutFeatureGate>(nameof(ControllerWithoutFeatureGate.ActionWithRequirementTypeAll));

            // Act
            var result = _processor.Process(context);

            // Assert
            result.Should().BeFalse();
        }

        #endregion

        #region Process Tests - RequirementType.Any

        [Fact]
        public void Process_WithRequirementTypeAny_OneFeatureEnabled_ReturnsTrue()
        {
            // Arrange
            SetupProcessorWithFeatureManager();
            _featureManagerMock.Setup(x => x.IsEnabledAsync("FeatureA"))
                .ReturnsAsync(false);
            _featureManagerMock.Setup(x => x.IsEnabledAsync("FeatureB"))
                .ReturnsAsync(true);

            var context = CreateAspNetCoreContext<ControllerWithoutFeatureGate>(nameof(ControllerWithoutFeatureGate.ActionWithRequirementTypeAny));

            // Act
            var result = _processor.Process(context);

            // Assert
            result.Should().BeTrue();
        }

        [Fact]
        public void Process_WithRequirementTypeAny_AllFeaturesDisabled_ReturnsFalse()
        {
            // Arrange
            SetupProcessorWithFeatureManager();
            _featureManagerMock.Setup(x => x.IsEnabledAsync("FeatureA"))
                .ReturnsAsync(false);
            _featureManagerMock.Setup(x => x.IsEnabledAsync("FeatureB"))
                .ReturnsAsync(false);

            var context = CreateAspNetCoreContext<ControllerWithoutFeatureGate>(nameof(ControllerWithoutFeatureGate.ActionWithRequirementTypeAny));

            // Act
            var result = _processor.Process(context);

            // Assert
            result.Should().BeFalse();
        }

        #endregion

        #region Process Tests - No Feature Manager Available

        [Fact]
        public void Process_WithNoFeatureManager_ReturnsTrue()
        {
            // Arrange - no feature manager setup
            _serviceProviderMock.Setup(x => x.GetService(typeof(IHttpContextAccessor)))
                .Returns((object?)null);
            _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureManager)))
                .Returns((object?)null);
            _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureManagerSnapshot)))
                .Returns((object?)null);

            _processor = new FeatureGateOperationProcessor(_serviceProviderMock.Object);

            var context = CreateAspNetCoreContext<ControllerWithFeatureGate>(nameof(ControllerWithFeatureGate.GetAction));

            // Act
            var result = _processor.Process(context);

            // Assert
            result.Should().BeTrue();
        }

        [Fact]
        public void Process_WithNullServiceProvider_WithControllerFeatureGate_ReturnsTrue()
        {
            // Arrange
            _processor = new FeatureGateOperationProcessor(null);
            var context = CreateAspNetCoreContext<ControllerWithFeatureGate>(nameof(ControllerWithFeatureGate.GetAction));

            // Act
            var result = _processor.Process(context);

            // Assert
            result.Should().BeTrue();
        }

        #endregion

        #region Process Tests - Using Request Services

        [Fact]
        public void Process_WithHttpContextRequestServices_UsesRequestScopeFeatureManager()
        {
            // Arrange
            var httpContextMock = new Mock<HttpContext>();
            var requestServicesMock = new Mock<IServiceProvider>();

            _featureManagerSnapshotMock.Setup(x => x.IsEnabledAsync("TestFeature"))
                .ReturnsAsync(true);

            requestServicesMock.Setup(x => x.GetService(typeof(IFeatureManagerSnapshot)))
                .Returns(_featureManagerSnapshotMock.Object);
            requestServicesMock.Setup(x => x.GetService(typeof(IFeatureManager)))
                .Returns(_featureManagerSnapshotMock.Object);

            httpContextMock.Setup(x => x.RequestServices).Returns(requestServicesMock.Object);
            _httpContextAccessorMock.Setup(x => x.HttpContext).Returns(httpContextMock.Object);

            _serviceProviderMock.Setup(x => x.GetService(typeof(IHttpContextAccessor)))
                .Returns(_httpContextAccessorMock.Object);

            _processor = new FeatureGateOperationProcessor(_serviceProviderMock.Object);

            var context = CreateAspNetCoreContext<ControllerWithFeatureGate>(nameof(ControllerWithFeatureGate.GetAction));

            // Act
            var result = _processor.Process(context);

            // Assert
            result.Should().BeTrue();
            _featureManagerSnapshotMock.Verify(x => x.IsEnabledAsync("TestFeature"), Times.Once);
        }

        #endregion

        #region Process Tests - Null ActionDescriptor

        [Fact]
        public void Process_WithNullApiDescription_ReturnsTrue()
        {
            // Arrange
            SetupProcessorWithFeatureManager();
            var context = CreateAspNetCoreContextWithNullApiDescription();

            // Act
            var result = _processor.Process(context);

            // Assert
            result.Should().BeTrue();
        }

        #endregion

        #region Process Tests - Controller and Action Both Have Feature Gates

        [Fact]
        public void Process_WithBothControllerAndActionFeatureGates_ControllerDisabled_ReturnsFalse()
        {
            // Arrange
            SetupProcessorWithFeatureManager();
            _featureManagerMock.Setup(x => x.IsEnabledAsync("ControllerFeature"))
                .ReturnsAsync(false);
            _featureManagerMock.Setup(x => x.IsEnabledAsync("NestedActionFeature"))
                .ReturnsAsync(true);

            var context = CreateAspNetCoreContext<ControllerWithFeatureGateAndActionFeatureGate>(
                nameof(ControllerWithFeatureGateAndActionFeatureGate.ActionWithOwnFeatureGate));

            // Act
            var result = _processor.Process(context);

            // Assert
            result.Should().BeFalse();
        }

        [Fact]
        public void Process_WithBothControllerAndActionFeatureGates_ActionDisabled_ReturnsFalse()
        {
            // Arrange
            SetupProcessorWithFeatureManager();
            _featureManagerMock.Setup(x => x.IsEnabledAsync("ControllerFeature"))
                .ReturnsAsync(true);
            _featureManagerMock.Setup(x => x.IsEnabledAsync("NestedActionFeature"))
                .ReturnsAsync(false);

            var context = CreateAspNetCoreContext<ControllerWithFeatureGateAndActionFeatureGate>(
                nameof(ControllerWithFeatureGateAndActionFeatureGate.ActionWithOwnFeatureGate));

            // Act
            var result = _processor.Process(context);

            // Assert
            result.Should().BeFalse();
        }

        [Fact]
        public void Process_WithBothControllerAndActionFeatureGates_BothEnabled_ReturnsTrue()
        {
            // Arrange
            SetupProcessorWithFeatureManager();
            _featureManagerMock.Setup(x => x.IsEnabledAsync("ControllerFeature"))
                .ReturnsAsync(true);
            _featureManagerMock.Setup(x => x.IsEnabledAsync("NestedActionFeature"))
                .ReturnsAsync(true);

            var context = CreateAspNetCoreContext<ControllerWithFeatureGateAndActionFeatureGate>(
                nameof(ControllerWithFeatureGateAndActionFeatureGate.ActionWithOwnFeatureGate));

            // Act
            var result = _processor.Process(context);

            // Assert
            result.Should().BeTrue();
        }

        #endregion

        #region Helper Methods

        private void SetupProcessorWithFeatureManager()
        {
            _serviceProviderMock.Setup(x => x.GetService(typeof(IHttpContextAccessor)))
                .Returns(_httpContextAccessorMock.Object);
            _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureManager)))
                .Returns(_featureManagerMock.Object);
            _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureManagerSnapshot)))
                .Returns((object?)null);
            _httpContextAccessorMock.Setup(x => x.HttpContext).Returns((HttpContext?)null);

            _processor = new FeatureGateOperationProcessor(_serviceProviderMock.Object);
        }

        private AspNetCoreOperationProcessorContext CreateAspNetCoreContext<TController>(string actionName)
            where TController : class
        {
            var controllerType = typeof(TController);
            var methodInfo = controllerType.GetMethod(actionName)!;

            var controllerActionDescriptor = new ControllerActionDescriptor
            {
                ControllerTypeInfo = controllerType.GetTypeInfo(),
                MethodInfo = methodInfo,
                ControllerName = controllerType.Name,
                ActionName = actionName
            };

            var apiDescription = new ApiDescription
            {
                ActionDescriptor = controllerActionDescriptor
            };

            var document = new OpenApiDocument();
            var operationDescription = new OpenApiOperationDescription
            {
                Path = "/test",
                Method = "GET",
                Operation = new OpenApiOperation()
            };

            // Create context with correct constructor signature
            var context = new AspNetCoreOperationProcessorContext(
                document,
                operationDescription,
                controllerType,
                methodInfo,
                null!, // OpenApiDocumentGenerator
                null!, // JsonSchemaResolver
                null!, // OpenApiDocumentGeneratorSettings
                new List<OpenApiOperationDescription>()
            )
            {
                ApiDescription = apiDescription
            };

            return context;
        }

        private AspNetCoreOperationProcessorContext CreateAspNetCoreContextWithNullApiDescription()
        {
            var document = new OpenApiDocument();
            var operationDescription = new OpenApiOperationDescription
            {
                Path = "/test",
                Method = "GET",
                Operation = new OpenApiOperation()
            };

            var context = new AspNetCoreOperationProcessorContext(
                document,
                operationDescription,
                typeof(object),
                typeof(object).GetMethod("ToString")!,
                null!, // OpenApiDocumentGenerator
                null!, // JsonSchemaResolver
                null!, // OpenApiDocumentGeneratorSettings
                new List<OpenApiOperationDescription>()
            )
            {
                ApiDescription = null!
            };

            return context;
        }

        #endregion

        #region Test Controllers

        [FeatureGate("TestFeature")]
        private class ControllerWithFeatureGate
        {
            public string GetAction() => "test";
        }

        private class ControllerWithoutFeatureGate
        {
            public string ActionWithoutFeatureGate() => "test";

            [FeatureGate("ActionFeature")]
            public string ActionWithFeatureGate() => "test";

            [FeatureGate(RequirementType.All, "Feature1", "Feature2")]
            public string ActionWithRequirementTypeAll() => "test";

            [FeatureGate(RequirementType.Any, "FeatureA", "FeatureB")]
            public string ActionWithRequirementTypeAny() => "test";
        }

        [FeatureGate("ControllerFeature")]
        private class ControllerWithFeatureGateAndActionFeatureGate
        {
            [FeatureGate("NestedActionFeature")]
            public string ActionWithOwnFeatureGate() => "test";
        }

        #endregion
    }
}
