using System.CommandLine;
using System.CommandLine.Invocation;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using Toggly.CLI.Services;

namespace Toggly.CLI.Output;

/// <summary>
/// Writes command results as human text (default) or camelCase JSON when <c>--json</c> is set.
/// </summary>
public sealed class CommandOutput
{
    private readonly Option<bool> _jsonOption;
    private readonly TextWriter _out;
    private readonly TextWriter _error;

    public CommandOutput(Option<bool> jsonOption, TextWriter? @out = null, TextWriter? error = null)
    {
        _jsonOption = jsonOption;
        _out = @out ?? Console.Out;
        _error = error ?? Console.Error;
    }

    public bool IsJson(InvocationContext context) =>
        context.ParseResult.GetValueForOption(_jsonOption);

    public async Task WriteAsync<T>(
        InvocationContext context,
        T value,
        JsonTypeInfo<T> typeInfo,
        Func<T, IEnumerable<string>> humanLines)
    {
        if (IsJson(context))
        {
            await _out.WriteLineAsync(JsonSerializer.Serialize(value, typeInfo));
            return;
        }

        foreach (var line in humanLines(value))
            await _out.WriteLineAsync(line);
    }

    public async Task WriteLinesAsync(IEnumerable<string> lines)
    {
        foreach (var line in lines)
            await _out.WriteLineAsync(line);
    }

    public async Task WriteErrorAsync(string message) =>
        await _error.WriteLineAsync(message);
}

/// <summary>
/// Shared CLI dependencies for noun commands (output mode + non-secret context prefs).
/// </summary>
public sealed class CliCommandContext
{
    public required CommandOutput Output { get; init; }
    public required Func<ContextStore> ContextStoreFactory { get; init; }
}
